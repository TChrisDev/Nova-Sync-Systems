<?php

declare(strict_types=1);

namespace App\Services\Assets;

use App\Enums\AlertSeverity;
use App\Enums\IncidentStatus;
use App\Enums\ProjectKind;
use App\Enums\ProjectStatus;
use App\Models\Alert;
use App\Models\AlertRule;
use App\Models\Client;
use App\Models\Incident;
use App\Models\Project;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Support\CodeGenerator;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Convierte lecturas en alertas y alertas críticas en incidentes.
 *
 * - Una alerta por regla y por lectura (índice único): evaluar dos veces no
 *   duplica nada.
 * - Las alertas de reglas que "abren incidente" se agrupan por cliente dentro
 *   de una ventana de minutos: tres sensores de humo a la vez son un evento.
 * - Si el cliente tiene un solo servicio continuo activo, el incidente queda
 *   asociado a ese proyecto para registrar ahí las horas.
 */
class AlertEngine
{
    public function __construct(
        private readonly CodeGenerator $codes,
        private readonly AuditLogger $audit,
    ) {}

    /** @return array{alerts: int, incidents: int} */
    public function evaluate(Client $client, ?User $actor = null): array
    {
        return DB::transaction(function () use ($client, $actor) {
            $created = 0;
            foreach ($this->rulesFor($client) as $rule) {
                $created += $this->applyRule($client, $rule);
            }

            $incidents = $this->openIncidents($client, $actor);

            return ['alerts' => $created, 'incidents' => $incidents];
        });
    }

    /**
     * Vuelve a calcular las alertas que todavía no están en un incidente (por
     * ejemplo, después de cambiar el umbral de una regla).
     *
     * @return array{alerts: int, incidents: int, removed: int}
     */
    public function reevaluate(Client $client, ?User $actor = null): array
    {
        return DB::transaction(function () use ($client, $actor) {
            $removed = Alert::query()->where('client_id', $client->getKey())->whereNull('incident_id')->delete();

            return [...$this->evaluate($client, $actor), 'removed' => $removed];
        });
    }

    /** Reglas generales (sin cliente) y las propias del cliente. */
    public function rulesFor(Client $client): Collection
    {
        return AlertRule::query()
            ->where('is_active', true)
            ->where(fn ($q) => $q->whereNull('client_id')->orWhere('client_id', $client->getKey()))
            ->get();
    }

    /**
     * Reglas que trae el sistema para un cliente nuevo. Son un punto de
     * partida editable desde la pantalla de telemetría.
     */
    public function ensureDefaultRules(Client $client, ?User $actor = null): int
    {
        if (AlertRule::query()->where('client_id', $client->getKey())->exists()) {
            return 0;
        }

        $defaults = [
            ['name' => 'Humo detectado', 'reading_type' => 'SMOKE', 'operator' => 'gte', 'threshold' => 1, 'severity' => AlertSeverity::Critical, 'opens_incident' => true],
            ['name' => 'Temperatura alta', 'reading_type' => 'TEMP', 'operator' => 'gte', 'threshold' => 24, 'severity' => AlertSeverity::Warning, 'opens_incident' => false],
            ['name' => 'Humedad alta', 'reading_type' => 'HUMIDITY', 'operator' => 'gte', 'threshold' => 60, 'severity' => AlertSeverity::Warning, 'opens_incident' => false],
            ['name' => 'Video degradado', 'reading_type' => 'STREAM', 'operator' => 'lt', 'threshold' => 15, 'severity' => AlertSeverity::Warning, 'opens_incident' => false],
        ];

        foreach ($defaults as $data) {
            $rule = new AlertRule([...$data, 'client_id' => $client->getKey(), 'is_active' => true]);
            $rule->forceFill(['created_by' => $actor?->getKey()])->save();
        }

        return count($defaults);
    }

    private function applyRule(Client $client, AlertRule $rule): int
    {
        $operator = match ($rule->operator->value) {
            'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<=', default => '=',
        };
        $now = now();

        $rows = DB::table('telemetry_readings as r')
            ->join('assets as a', 'a.id', '=', 'r.asset_id')
            ->where('a.client_id', $client->getKey())
            ->where('a.reading_type', $rule->reading_type)
            ->whereNotNull('r.value')
            ->where('r.value', $operator, $rule->threshold)
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('alerts')->whereColumn('alerts.telemetry_reading_id', 'r.id')->where('alerts.alert_rule_id', $rule->getKey()))
            ->orderBy('r.id')
            ->get(['r.id', 'r.asset_id', 'r.recorded_at', 'r.value']);

        foreach ($rows->chunk(500) as $chunk) {
            DB::table('alerts')->insertOrIgnore($chunk->map(fn ($row) => [
                'client_id' => $client->getKey(),
                'asset_id' => $row->asset_id,
                'alert_rule_id' => $rule->getKey(),
                'telemetry_reading_id' => $row->id,
                'triggered_at' => $row->recorded_at,
                'value' => $row->value,
                'severity' => $rule->severity->value,
                'created_at' => $now,
                'updated_at' => $now,
            ])->all());
        }

        return $rows->count();
    }

    private function openIncidents(Client $client, ?User $actor): int
    {
        $window = max(1, (int) config('nova.assets.incident_window_minutes', 10));
        $pending = Alert::query()
            ->with(['asset:id,name,location', 'rule:id,name,severity'])
            ->where('client_id', $client->getKey())
            ->whereNull('incident_id')
            ->whereHas('rule', fn ($q) => $q->where('opens_incident', true))
            ->orderBy('triggered_at')
            ->orderBy('id')
            ->get();

        $created = 0;
        $group = collect();
        $start = null;

        $flush = function () use (&$group, &$created, $client, $actor) {
            if ($group->isNotEmpty()) {
                $this->createIncident($client, $group, $actor);
                $created++;
            }
            $group = collect();
        };

        foreach ($pending as $alert) {
            $at = CarbonImmutable::parse($alert->triggered_at);
            if ($start && $at->diffInMinutes($start, true) > $window) {
                $flush();
                $start = null;
            }
            $start ??= $at;
            $group->push($alert);
        }
        $flush();

        return $created;
    }

    /** @param  Collection<int, Alert>  $alerts */
    private function createIncident(Client $client, Collection $alerts, ?User $actor): Incident
    {
        $first = $alerts->first();
        $assets = $alerts->pluck('asset')->unique('id');
        $ruleNames = $alerts->pluck('rule.name')->unique()->values();
        $severity = $alerts->sortByDesc(fn (Alert $a) => $a->severity->rank())->first()->severity;
        $openedAt = CarbonImmutable::parse($first->triggered_at);

        $title = $assets->count() > 1
            ? "{$ruleNames->implode(' y ')} en {$assets->count()} equipos a la vez"
            : "{$ruleNames->implode(' y ')} en {$assets->first()->name}";

        $locations = $assets->pluck('location')->filter()->unique()->values();

        $incident = new Incident([
            'title' => mb_substr($title, 0, 150),
            'severity' => $severity,
            'description' => 'Abierto automáticamente. Equipos: '.$assets->pluck('name')->implode(', ').($locations->isNotEmpty() ? '. Ubicación: '.$locations->implode(', ') : '').'.',
        ]);
        $incident->forceFill([
            'client_id' => $client->getKey(),
            'project_id' => $this->supportProject($client)?->getKey(),
            'code' => $this->codes->nextIncidentCode((int) $openedAt->setTimezone(config('nova.timezone'))->format('Y')),
            'status' => IncidentStatus::Open,
            'opened_at' => $openedAt,
            'created_by' => $actor?->getKey(),
        ])->save();

        Alert::query()->whereKey($alerts->pluck('id'))->update(['incident_id' => $incident->getKey()]);
        $this->audit->log('incident.opened', $actor, $incident, ['code' => $incident->code, 'alerts' => $alerts->count(), 'automatic' => true]);

        return $incident;
    }

    /** El servicio continuo activo del cliente, si hay exactamente uno. */
    public function supportProject(Client $client): ?Project
    {
        $projects = Project::query()
            ->whereHas('contract', fn ($q) => $q->where('client_id', $client->getKey()))
            ->where('status', ProjectStatus::Active->value)
            ->where('kind', ProjectKind::OngoingService->value)
            ->limit(2)
            ->get();

        return $projects->count() === 1 ? $projects->first() : null;
    }
}
