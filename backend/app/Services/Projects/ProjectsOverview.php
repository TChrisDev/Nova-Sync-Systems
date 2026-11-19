<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Enums\ProjectKind;
use App\Enums\ProjectStatus;
use App\Enums\TimeEntryStatus;
use App\Models\Project;
use App\Models\User;
use App\Support\BusinessCalendar;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Indicadores de Proyectos y capacidad para los gráficos del módulo.
 *
 * Respeta el mismo alcance que el listado: con projects.view se ven todos;
 * con projects.lead, solo los proyectos que la persona lidera. La salud se
 * calcula con ProjectHealth, igual que en el listado y el detalle.
 */
class ProjectsOverview
{
    public function __construct(private readonly ProjectHealth $health) {}

    /** @return array<string, mixed> */
    public function build(User $user, int $weeks = 8): array
    {
        $projects = Project::query()
            ->with(['contract.client:id,name', 'leader:id,name'])
            ->when(! $user->hasPermission('projects.view'), fn ($q) => $q->ledBy($user))
            ->get();
        $this->health->attach($projects);

        $open = $projects->filter(fn (Project $p) => $p->status !== ProjectStatus::Closed);

        $healthCount = ['ok' => 0, 'warning' => 0, 'danger' => 0];
        $flags = [];
        foreach ($open as $project) {
            $health = $project->getRelation('health');
            $healthCount[$health['level']]++;
            foreach ($health['flags'] as $flag) {
                $flags[$flag['code']] ??= ['code' => $flag['code'], 'label' => $flag['label'], 'severity' => $flag['severity'], 'count' => 0];
                $flags[$flag['code']]['count']++;
            }
        }

        // Proyectos con presupuesto, del más consumido al menos consumido.
        $budgets = $open
            ->filter(fn (Project $p) => $p->getRelation('health')['budget_ratio'] !== null)
            ->sortByDesc(fn (Project $p) => $p->getRelation('health')['budget_ratio'])
            ->take(8)
            ->map(fn (Project $p) => [
                'id' => $p->id,
                'code' => $p->code,
                'name' => $p->name,
                'client' => $p->contract?->client?->name,
                'budget_minutes' => $p->getRelation('health')['budget_minutes'],
                'consumed_minutes' => $p->getRelation('health')['budget_consumed_minutes'],
                'ratio' => $p->getRelation('health')['budget_ratio'],
                'level' => $p->getRelation('health')['level'],
            ])
            ->values();

        return [
            'scope' => $user->hasPermission('projects.view') ? 'all' : 'led',
            'totals' => [
                'projects' => $projects->count(),
                'open' => $open->count(),
                'active' => $projects->where('status', ProjectStatus::Active)->count(),
                'at_risk' => $healthCount['warning'] + $healthCount['danger'],
                'team_members' => (int) DB::table('allocations')
                    ->whereIn('project_id', $open->pluck('id'))
                    ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', BusinessCalendar::today()->toDateString()))
                    ->distinct()->count('user_id'),
            ],
            'by_status' => array_map(fn (ProjectStatus $s) => [
                'value' => $s->value,
                'label' => $s->label(),
                'count' => $projects->where('status', $s)->count(),
            ], ProjectStatus::cases()),
            'by_kind' => array_map(fn (ProjectKind $k) => [
                'value' => $k->value,
                'label' => $k->label(),
                'count' => $open->where('kind', $k)->count(),
            ], ProjectKind::cases()),
            'health' => $healthCount,
            'flags' => array_values($flags),
            'budgets' => $budgets->all(),
            'weekly_hours' => $this->weeklyHours($projects->pluck('id')->all(), $weeks),
        ];
    }

    /**
     * Horas registradas por semana y estado en los proyectos visibles.
     *
     * @param  list<int>  $ids
     * @return list<array{week_start: string, approved: int, submitted: int, draft: int}>
     */
    private function weeklyHours(array $ids, int $weeks): array
    {
        $monday = BusinessCalendar::today()->startOfWeek(CarbonInterface::MONDAY);
        $first = $monday->subWeeks($weeks - 1);
        $buckets = [];
        for ($i = 0; $i < $weeks; $i++) {
            $buckets[$first->addWeeks($i)->toDateString()] = ['approved' => 0, 'submitted' => 0, 'draft' => 0];
        }

        if ($ids) {
            DB::table('time_entries')
                ->whereIn('project_id', $ids)
                ->whereBetween('work_date', [$first->toDateString(), $monday->addDays(6)->toDateString()])
                ->whereIn('status', [TimeEntryStatus::Approved->value, TimeEntryStatus::Submitted->value, TimeEntryStatus::Draft->value])
                ->groupBy('work_date', 'status')
                ->selectRaw('work_date AS day, status, SUM(minutes) AS minutes')
                ->get()
                ->each(function ($row) use (&$buckets) {
                    $day = BusinessCalendar::parseDate(substr((string) $row->day, 0, 10));
                    $key = $day->startOfWeek(CarbonInterface::MONDAY)->toDateString();
                    if (isset($buckets[$key])) {
                        $buckets[$key][$row->status] += (int) $row->minutes;
                    }
                });
        }

        return array_map(fn (string $week, array $v) => ['week_start' => $week] + $v, array_keys($buckets), $buckets);
    }
}
