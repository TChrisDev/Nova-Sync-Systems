<?php

declare(strict_types=1);

namespace App\Services\Timesheets;

use App\Enums\TimeEntryStatus;
use App\Models\Project;
use App\Models\StaffProfile;
use App\Models\User;
use App\Support\BusinessCalendar;
use App\Support\ColombianHolidays;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * Datos para los gráficos del registro de horas, siempre sobre el mismo
 * conjunto que se está viendo (alcance y filtros de TimeEntryQuery).
 *
 * - Semanas de lunes a domingo, incluidas las que no tienen horas (un
 *   gráfico con semanas faltantes miente sobre la tendencia).
 * - Se agrupa por día en la base y por semana aquí: así la consulta es la
 *   misma en SQLite y en PostgreSQL.
 * - La capacidad solo se calcula para "mis horas": es la jornada de la
 *   persona descontando festivos, la misma regla del módulo de capacidad.
 */
class TimeEntryReport
{
    private const TOP = 8;

    public function __construct(private readonly TimeEntryQuery $query) {}

    /**
     * @return array<string, mixed>
     */
    public function build(Builder $base, CarbonImmutable $from, CarbonImmutable $to, bool $withCost, ?User $capacityFor = null): array
    {
        return [
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'totals' => $this->query->summary(clone $base, $withCost),
            'people' => (clone $base)->distinct()->count('user_id'),
            'weeks' => $this->weeks($base, $from, $to, $capacityFor),
            'by_project' => $this->byProject($base),
            'by_user' => $this->byUser($base),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function weeks(Builder $base, CarbonImmutable $from, CarbonImmutable $to, ?User $capacityFor): array
    {
        $statuses = array_map(fn (TimeEntryStatus $s) => $s->value, TimeEntryStatus::cases());

        $rows = (clone $base)->toBase()
            ->selectRaw(
                'work_date, status, SUM(minutes) AS minutes, '.
                'SUM(CASE WHEN is_after_hours THEN minutes ELSE 0 END) AS after_hours, '.
                'SUM(CASE WHEN is_on_call THEN minutes ELSE 0 END) AS on_call',
            )
            ->groupBy('work_date', 'status')
            ->reorder()
            ->get();

        $dailyCapacity = $capacityFor ? $this->weeklyCapacity($capacityFor) / 5 : null;
        $weeks = [];
        $cursor = $from->startOfWeek(CarbonImmutable::MONDAY);

        while ($cursor->lte($to)) {
            $key = $cursor->toDateString();
            $weeks[$key] = [
                'week_start' => $key,
                'week_end' => $cursor->addDays(6)->toDateString(),
                'total_minutes' => 0,
                'by_status' => array_fill_keys($statuses, 0),
                'after_hours_minutes' => 0,
                'on_call_minutes' => 0,
                'holidays' => $this->holidays($cursor, $from, $to),
                'working_days' => 0,
                'capacity_minutes' => null,
            ];

            $workingDays = 0;
            for ($day = 0; $day < 5; $day++) {
                $date = $cursor->addDays($day);
                if ($date->betweenIncluded($from, $to) && ! ColombianHolidays::isHoliday($date)) {
                    $workingDays++;
                }
            }
            $weeks[$key]['working_days'] = $workingDays;
            if ($dailyCapacity !== null) {
                $weeks[$key]['capacity_minutes'] = (int) round($dailyCapacity * $workingDays);
            }

            $cursor = $cursor->addWeek();
        }

        foreach ($rows as $row) {
            $date = BusinessCalendar::parseDate(substr((string) $row->work_date, 0, 10));
            $key = $date->startOfWeek(CarbonImmutable::MONDAY)->toDateString();
            if (! isset($weeks[$key])) {
                continue;
            }

            $minutes = (int) $row->minutes;
            $weeks[$key]['total_minutes'] += $minutes;
            $weeks[$key]['by_status'][$row->status] = ($weeks[$key]['by_status'][$row->status] ?? 0) + $minutes;
            $weeks[$key]['after_hours_minutes'] += (int) $row->after_hours;
            $weeks[$key]['on_call_minutes'] += (int) $row->on_call;
        }

        return array_values($weeks);
    }

    /** @return list<array{date: string, name: string}> */
    private function holidays(CarbonImmutable $monday, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $found = [];
        for ($day = 0; $day < 7; $day++) {
            $date = $monday->addDays($day);
            if ($date->betweenIncluded($from, $to) && ($name = ColombianHolidays::name($date))) {
                $found[] = ['date' => $date->toDateString(), 'name' => $name];
            }
        }

        return $found;
    }

    /** @return array{items: list<array<string, mixed>>, other_minutes: int, count: int} */
    private function byProject(Builder $base): array
    {
        $approved = TimeEntryStatus::Approved->value;
        $rows = (clone $base)->toBase()
            ->selectRaw('project_id, SUM(minutes) AS minutes, SUM(CASE WHEN status = ? THEN minutes ELSE 0 END) AS approved_minutes', [$approved])
            ->groupBy('project_id')
            ->reorder()
            ->orderByDesc('minutes')
            ->get();

        $top = $rows->take(self::TOP);
        $projects = Project::query()->whereKey($top->pluck('project_id'))->get(['id', 'code', 'name'])->keyBy('id');

        return [
            'items' => $top->map(fn ($row) => [
                'project' => ['id' => (int) $row->project_id, 'code' => $projects->get($row->project_id)?->code, 'name' => $projects->get($row->project_id)?->name],
                'minutes' => (int) $row->minutes,
                'approved_minutes' => (int) $row->approved_minutes,
            ])->values()->all(),
            'other_minutes' => (int) $rows->slice(self::TOP)->sum('minutes'),
            'count' => $rows->count(),
        ];
    }

    /** @return array{items: list<array<string, mixed>>, other_minutes: int, count: int} */
    private function byUser(Builder $base): array
    {
        $rows = (clone $base)->toBase()
            ->selectRaw('user_id, SUM(minutes) AS minutes')
            ->groupBy('user_id')
            ->reorder()
            ->orderByDesc('minutes')
            ->get();

        $top = $rows->take(self::TOP);
        $users = User::query()->whereKey($top->pluck('user_id'))->get(['id', 'name'])->keyBy('id');

        return [
            'items' => $top->map(fn ($row) => [
                'user' => ['id' => (int) $row->user_id, 'name' => $users->get($row->user_id)?->name],
                'minutes' => (int) $row->minutes,
            ])->values()->all(),
            'other_minutes' => (int) $rows->slice(self::TOP)->sum('minutes'),
            'count' => $rows->count(),
        ];
    }

    private function weeklyCapacity(User $user): int
    {
        $profile = StaffProfile::query()->where('user_id', $user->getKey())->first();

        return $profile?->weekly_capacity_minutes ?? (int) config('nova.projects.default_weekly_hours', 42) * 60;
    }
}
