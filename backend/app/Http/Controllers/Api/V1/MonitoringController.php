<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Enums\AlertSeverity;
use App\Enums\IncidentStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Assets\AlertRuleRequest;
use App\Http\Requests\Assets\IncidentRequest;
use App\Http\Resources\AlertRuleResource;
use App\Http\Resources\IncidentResource;
use App\Http\Resources\TimeEntryResource;
use App\Models\Alert;
use App\Models\AlertRule;
use App\Models\Asset;
use App\Models\Client;
use App\Models\Incident;
use App\Models\User;
use App\Services\Assets\AlertEngine;
use App\Services\Assets\AssetInsights;
use App\Services\Assets\IncidentService;
use App\Services\Assets\TelemetryService;
use App\Services\Audit\AuditLogger;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/** Telemetría, reglas de alerta, alertas e incidentes. */
class MonitoringController extends Controller
{
    public function __construct(
        private readonly AlertEngine $engine,
        private readonly AuditLogger $audit,
    ) {}

    public function sensors(Request $request, TelemetryService $telemetry): JsonResponse
    {
        return response()->json(['data' => $telemetry->sensors($this->client($request))]);
    }

    public function series(Request $request, TelemetryService $telemetry): JsonResponse
    {
        $data = $request->validate([
            'client_id' => ['required', 'integer', 'exists:clients,id'],
            'asset_ids' => ['required', 'array', 'min:1', 'max:12'],
            'asset_ids.*' => ['integer'],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after:from'],
            'bucket' => ['sometimes', 'integer', 'min:1', 'max:1440'],
        ]);

        $assets = Asset::query()->where('client_id', $data['client_id'])->whereKey($data['asset_ids'])->whereNotNull('reading_type')->get();
        abort_if($assets->isEmpty(), 404, 'No se encontraron sensores con esos datos.');

        return response()->json(['data' => $telemetry->series(
            $assets,
            isset($data['from']) ? CarbonImmutable::parse($data['from']) : null,
            isset($data['to']) ? CarbonImmutable::parse($data['to']) : null,
            (int) ($data['bucket'] ?? 10),
        )]);
    }

    public function alerts(Request $request, AssetInsights $insights): JsonResponse
    {
        $data = $request->validate([
            'client_id' => ['required', 'integer', 'exists:clients,id'],
            'severity' => ['sometimes', 'nullable', Rule::enum(AlertSeverity::class)],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $client = Client::query()->findOrFail($data['client_id']);
        $recent = collect($insights->recentAlerts($client, 100));
        if (! empty($data['severity'])) {
            $recent = $recent->where('severity.value', $data['severity']);
        }

        return response()->json(['data' => $recent->take($data['limit'] ?? 30)->values()]);
    }

    // --- Reglas ---------------------------------------------------------------

    public function rules(Request $request): AnonymousResourceCollection
    {
        $client = $this->client($request);

        return AlertRuleResource::collection(
            AlertRule::query()
                ->withCount(['alerts' => fn ($q) => $q->where('client_id', $client->getKey())])
                ->where(fn ($q) => $q->whereNull('client_id')->orWhere('client_id', $client->getKey()))
                ->orderByDesc('is_active')
                ->orderBy('name')
                ->get(),
        );
    }

    public function storeRule(AlertRuleRequest $request): JsonResponse
    {
        $rule = new AlertRule($request->validated());
        $rule->forceFill(['created_by' => $request->user()->getKey()])->save();
        $this->audit->log('alert_rule.created', $request->user(), $rule, ['name' => $rule->name, 'condition' => $rule->describe()]);

        return (new AlertRuleResource($rule))->additional(['message' => 'Regla creada. Usa «Evaluar reglas» para aplicarla a las lecturas guardadas.'])->response()->setStatusCode(201);
    }

    public function updateRule(AlertRuleRequest $request, AlertRule $rule): AlertRuleResource
    {
        $rule->fill($request->validated());
        $changes = array_keys($rule->getDirty());
        $rule->save();
        $this->audit->log('alert_rule.updated', $request->user(), $rule, ['name' => $rule->name, 'fields' => $changes]);

        return (new AlertRuleResource($rule))->additional(['message' => 'Regla actualizada.']);
    }

    public function destroyRule(Request $request, AlertRule $rule): JsonResponse
    {
        abort_unless($request->user()->hasPermission('assets.monitor'), 403, 'No tienes permiso para administrar reglas de alerta.');
        if ($rule->alerts()->whereNotNull('incident_id')->exists()) {
            return response()->json(['message' => 'Esta regla originó incidentes: desactívala en lugar de eliminarla para conservar el historial.', 'code' => 'rule_in_use'], 409);
        }

        $this->audit->log('alert_rule.deleted', $request->user(), $rule, ['name' => $rule->name]);
        $rule->delete();

        return response()->json(['message' => 'Regla eliminada.']);
    }

    public function evaluate(Request $request): JsonResponse
    {
        abort_unless($request->user()->hasPermission('assets.monitor'), 403, 'No tienes permiso para evaluar reglas.');
        $result = $this->engine->reevaluate($this->client($request), $request->user());

        return response()->json([
            'data' => $result,
            'message' => "Reglas evaluadas: {$result['alerts']} alertas".($result['incidents'] ? " y {$result['incidents']} incidentes nuevos" : '').'.',
        ]);
    }

    // --- Incidentes -----------------------------------------------------------

    public function incidents(Request $request): AnonymousResourceCollection
    {
        $data = $request->validate([
            'client_id' => ['required', 'integer', 'exists:clients,id'],
            'status' => ['sometimes', 'nullable', Rule::in([...IncidentStatus::values(), 'open_any'])],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);

        $status = $data['status'] ?? null;

        return IncidentResource::collection(
            Incident::query()
                ->with(['project:id,code,name', 'assignee:id,name'])
                ->withCount('alerts')
                ->withSum('timeEntries', 'minutes')
                ->where('client_id', $data['client_id'])
                ->when($status === 'open_any', fn ($q) => $q->whereIn('status', [IncidentStatus::Open->value, IncidentStatus::InProgress->value]))
                ->when($status && $status !== 'open_any', fn ($q) => $q->where('status', $status))
                ->orderByRaw("CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END")
                ->orderByDesc('opened_at')
                ->paginate(20)
                ->withQueryString(),
        );
    }

    public function incident(Request $request, Incident $incident): JsonResponse
    {
        $incident->load(['client:id,name', 'project:id,code,name', 'assignee:id,name'])->loadCount('alerts')->loadSum('timeEntries', 'minutes');

        $alerts = Alert::query()
            ->with(['asset:id,name,location,reading_unit', 'rule:id,name', 'reading:id,status,note'])
            ->where('incident_id', $incident->id)
            ->orderBy('triggered_at')
            ->get();

        // Contexto: lo que reportaron los demás sensores del cliente alrededor del evento.
        $first = $alerts->first()?->triggered_at;
        $context = $first
            ? \App\Models\TelemetryReading::query()
                ->with('asset:id,name,location,reading_type,reading_unit')
                ->whereHas('asset', fn ($q) => $q->where('client_id', $incident->client_id))
                ->whereBetween('recorded_at', [$first->copy()->subMinutes(2), $first->copy()->addMinutes(2)])
                ->whereNotIn('status', ['NORMAL', 'ACTIVE', 'LOCKED', 'CLEAR', 'ON', 'ONLINE'])
                ->orderBy('recorded_at')
                ->limit(40)
                ->get()
                ->map(fn ($r) => ['at' => $r->recorded_at->toIso8601String(), 'asset' => $r->asset->name, 'location' => $r->asset->location, 'status' => $r->status, 'value' => $r->value, 'unit' => $r->asset->reading_unit, 'note' => $r->note])
            : collect();

        $entries = $incident->timeEntries()->with(['user', 'project', 'reviewer', 'incident'])->orderByDesc('work_date')->get();

        return response()->json(['data' => [
            ...(new IncidentResource($incident))->resolve($request),
            'alerts' => $alerts->map(fn (Alert $a) => [
                'id' => $a->id,
                'triggered_at' => $a->triggered_at->toIso8601String(),
                'asset' => ['id' => $a->asset->id, 'name' => $a->asset->name, 'location' => $a->asset->location],
                'rule' => $a->rule->name,
                'value' => $a->value,
                'unit' => $a->asset->reading_unit,
                'severity' => ['value' => $a->severity->value, 'label' => $a->severity->label()],
                'status' => $a->reading?->status,
                'note' => $a->reading?->note,
            ]),
            'context' => $context,
            'time_entries' => TimeEntryResource::collection($entries)->resolve($request),
            'assignable' => User::query()->where('is_active', true)->whereHas('roles.permissions', fn ($q) => $q->where('code', 'assets.incidents'))->orderBy('name')->get(['id', 'name']),
        ]]);
    }

    public function storeIncident(IncidentRequest $request, IncidentService $incidents): JsonResponse
    {
        $client = Client::query()->findOrFail($request->validated('client_id'));
        $incident = $incidents->open($request->user(), $client, $request->validated());

        return (new IncidentResource($incident))->additional(['message' => "Incidente {$incident->code} abierto."])->response()->setStatusCode(201);
    }

    public function updateIncident(IncidentRequest $request, Incident $incident, IncidentService $incidents): IncidentResource
    {
        $incident = $incidents->update($request->user(), $incident, $request->validated());

        return (new IncidentResource($incident->load(['project:id,code,name', 'assignee:id,name'])))->additional(['message' => 'Incidente actualizado.']);
    }

    private function client(Request $request): Client
    {
        $id = $request->validate(['client_id' => ['required', 'integer', 'exists:clients,id']])['client_id'];

        return Client::query()->findOrFail($id);
    }
}
