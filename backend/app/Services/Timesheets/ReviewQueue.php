<?php

declare(strict_types=1);

namespace App\Services\Timesheets;

use App\Enums\TimeEntryStatus;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * Bandeja de aprobación: horas enviadas agrupadas por persona y proyecto,
 * que es como las revisa un líder ("las 40 h de Sara en la app"). Cada grupo
 * trae sus ids para aprobar o rechazar el grupo completo en un solo paso;
 * el servicio vuelve a autorizar registro por registro.
 */
class ReviewQueue
{
    /** @return array{groups: list<array<string, mixed>>, totals: array<string, mixed>} */
    public function build(Builder $base): array
    {
        $entries = (clone $base)
            ->where('status', TimeEntryStatus::Submitted->value)
            ->reorder()
            ->orderBy('work_date')
            ->orderBy('id')
            ->get(['id', 'user_id', 'project_id', 'work_date', 'minutes', 'is_after_hours', 'is_on_call', 'submitted_at']);

        $users = User::query()->whereKey($entries->pluck('user_id')->unique())->get(['id', 'name'])->keyBy('id');
        $projects = Project::query()->whereKey($entries->pluck('project_id')->unique())->get(['id', 'code', 'name'])->keyBy('id');

        $groups = $entries
            ->groupBy(fn ($entry) => $entry->user_id.'-'.$entry->project_id)
            ->map(function ($items) use ($users, $projects) {
                $first = $items->first();

                return [
                    'key' => $first->user_id.'-'.$first->project_id,
                    'user' => ['id' => $first->user_id, 'name' => $users->get($first->user_id)?->name],
                    'project' => ['id' => $first->project_id, 'code' => $projects->get($first->project_id)?->code, 'name' => $projects->get($first->project_id)?->name],
                    'entries' => $items->count(),
                    'minutes' => (int) $items->sum('minutes'),
                    'after_hours_minutes' => (int) $items->where('is_after_hours', true)->sum('minutes'),
                    'from' => $items->min(fn ($e) => $e->work_date->toDateString()),
                    'to' => $items->max(fn ($e) => $e->work_date->toDateString()),
                    'submitted_at' => $items->min('submitted_at')?->toIso8601String(),
                    'ids' => $items->pluck('id')->values()->all(),
                ];
            })
            ->sortByDesc('minutes')
            ->values();

        return [
            'groups' => $groups->all(),
            'totals' => [
                'entries' => $entries->count(),
                'minutes' => (int) $entries->sum('minutes'),
                'people' => $entries->pluck('user_id')->unique()->count(),
                'projects' => $entries->pluck('project_id')->unique()->count(),
                'oldest_date' => $entries->first()?->work_date->toDateString(),
                'oldest_user' => $entries->first() ? $users->get($entries->first()->user_id)?->name : null,
            ],
        ];
    }
}
