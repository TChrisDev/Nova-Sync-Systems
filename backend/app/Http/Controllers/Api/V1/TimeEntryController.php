<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Enums\ProjectStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\TimeEntries\StoreTimeEntryRequest;
use App\Http\Requests\TimeEntries\TimeEntryBatchRequest;
use App\Http\Requests\TimeEntries\TimeEntryIndexRequest;
use App\Http\Requests\TimeEntries\TimeEntryReportRequest;
use App\Http\Requests\TimeEntries\UpdateTimeEntryRequest;
use App\Http\Resources\ProjectResource;
use App\Http\Resources\TimeEntryResource;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Services\Timesheets\ReviewQueue;
use App\Services\Timesheets\TimeEntriesExport;
use App\Services\Timesheets\TimeEntryQuery;
use App\Services\Timesheets\TimeEntryReport;
use App\Services\Timesheets\TimeEntryService;
use App\Support\BusinessCalendar;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TimeEntryController extends Controller
{
    public function __construct(
        private readonly TimeEntryService $entries,
        private readonly TimeEntryQuery $query,
    ) {}

    public function index(TimeEntryIndexRequest $request): AnonymousResourceCollection
    {
        $entries = $this->query->for($request->user(), $request->scope(), $request->filters())
            ->with(['user', 'project', 'reviewer', 'incident'])
            ->orderByDesc('work_date')
            ->orderByDesc('id')
            ->paginate($request->validated('per_page') ?? 20)
            ->withQueryString();

        return TimeEntryResource::collection($entries);
    }

    /** Métricas del mismo conjunto que se está viendo (mismo alcance y filtros). */
    public function summary(TimeEntryIndexRequest $request): JsonResponse
    {
        $query = $this->query->for($request->user(), $request->scope(), $request->filters());
        $withCost = $request->user()->can('viewFinancials', TimeEntry::class);

        return response()->json(['data' => $this->query->summary($query, $withCost)]);
    }

    /**
     * Datos de los gráficos (semanas, proyectos, personas y totales) para el
     * mismo alcance y filtros del listado. La capacidad semanal solo se
     * calcula para las horas propias.
     */
    public function report(TimeEntryReportRequest $request, TimeEntryReport $report): JsonResponse
    {
        [$from, $to] = $request->range();
        $user = $request->user();
        $query = $this->query->for($user, $request->scope(), $request->filters());

        return response()->json(['data' => $report->build(
            $query,
            $from,
            $to,
            $user->can('viewFinancials', TimeEntry::class),
            $request->scope() === 'mine' ? $user : null,
        )]);
    }

    /** Bandeja de aprobación agrupada por persona y proyecto. */
    public function reviewQueue(Request $request, ReviewQueue $queue): JsonResponse
    {
        $user = $request->user();
        abort_unless($this->query->canUseScope($user, 'review'), 403, 'No tienes permiso para aprobar horas.');

        $validated = $request->validate(['project_id' => ['sometimes', 'integer']]);

        return response()->json(['data' => $queue->build($this->query->for($user, 'review', $validated))]);
    }

    public function export(TimeEntryIndexRequest $request, TimeEntriesExport $export): StreamedResponse
    {
        $query = $this->query->for($request->user(), $request->scope(), $request->filters());

        return $export->stream($request->user(), $query, $request->scope(), $request->filters());
    }

    /** Proyectos en los que la persona puede registrar horas hoy. */
    public function projects(Request $request): AnonymousResourceCollection
    {
        Gate::authorize('create', TimeEntry::class);
        $user = $request->user();
        $today = BusinessCalendar::today()->toDateString();

        $projects = Project::query()
            ->with(['contract.client'])
            ->where('status', ProjectStatus::Active->value)
            ->where(fn ($q) => $q
                ->where('leader_id', $user->getKey())
                ->orWhereHas('allocations', fn ($a) => $a->where('user_id', $user->getKey())->activeOn($today)))
            ->orderBy('code')
            ->get();

        return ProjectResource::collection($projects);
    }

    public function store(StoreTimeEntryRequest $request): JsonResponse
    {
        $entry = $this->entries->create($request->user(), $request->validated());

        return (new TimeEntryResource($entry->load(['user', 'project', 'reviewer', 'incident'])))
            ->additional(['message' => 'Horas registradas en borrador.'])
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpdateTimeEntryRequest $request, TimeEntry $timeEntry): TimeEntryResource
    {
        $entry = $this->entries->update($request->user(), $timeEntry, $request->validated());

        return (new TimeEntryResource($entry->load(['user', 'project', 'reviewer', 'incident'])))->additional(['message' => 'Registro actualizado.']);
    }

    public function destroy(TimeEntry $timeEntry): JsonResponse
    {
        Gate::authorize('delete', $timeEntry);
        $this->entries->delete($timeEntry);

        return response()->json(['message' => 'Registro eliminado.']);
    }

    public function submit(TimeEntryBatchRequest $request): JsonResponse
    {
        $count = $this->entries->submit($request->user(), $request->ids());

        return response()->json(['message' => $count === 1 ? 'Registro enviado a aprobación.' : "{$count} registros enviados a aprobación.", 'data' => ['count' => $count]]);
    }

    public function approve(TimeEntryBatchRequest $request): JsonResponse
    {
        $count = $this->entries->approve($request->user(), $request->ids());

        return response()->json(['message' => $count === 1 ? 'Registro aprobado.' : "{$count} registros aprobados.", 'data' => ['count' => $count]]);
    }

    public function reject(TimeEntryBatchRequest $request): JsonResponse
    {
        $count = $this->entries->reject($request->user(), $request->ids(), (string) $request->validated('reason'));

        return response()->json(['message' => $count === 1 ? 'Registro rechazado.' : "{$count} registros rechazados.", 'data' => ['count' => $count]]);
    }
}
