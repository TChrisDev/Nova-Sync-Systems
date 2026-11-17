<?php

namespace App\Services\Notifications;

use App\Enums\ProjectStatus;
use App\Models\Project;
use App\Models\User;
use App\Notifications\ProjectEndingSoon;
use App\Support\BusinessCalendar;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Busca los proyectos abiertos que están por llegar a su fecha de fin y
 * avisa al líder y a quienes administran proyectos.
 *
 * Cada umbral (por defecto 15, 7, 1 y 0 días) se avisa una sola vez por
 * proyecto y fecha de fin: correr el comando varias veces el mismo día no
 * repite avisos, y si alguien extiende la fecha, los avisos empiezan de nuevo.
 */
class ProjectDeadlineNotifier
{
    /** @return list<int> umbrales en días, de mayor a menor */
    public static function thresholds(): array
    {
        $raw = config('nova.notifications.project_deadline_days', [15, 7, 1, 0]);
        $days = is_array($raw) ? $raw : explode(',', (string) $raw);
        $days = array_values(array_unique(array_map('intval', array_filter($days, fn ($d) => is_numeric(trim((string) $d)) && (int) $d >= 0))));
        rsort($days);

        return $days ?: [0];
    }

    /** @return array{projects: int, notifications: int} */
    public function run(): array
    {
        $thresholds = self::thresholds();
        $today = BusinessCalendar::today();
        $until = $today->addDays($thresholds[0])->toDateString();

        $projects = Project::query()
            ->with('leader')
            ->whereIn('status', [ProjectStatus::Planned->value, ProjectStatus::Active->value, ProjectStatus::OnHold->value])
            ->whereNotNull('end_date')
            ->whereDate('end_date', '>=', $today->toDateString())
            ->whereDate('end_date', '<=', $until)
            ->orderBy('end_date')
            ->get();

        $managers = User::query()->active()->withPermission('projects.update')->get();
        $alerted = 0;
        $sent = 0;

        foreach ($projects as $project) {
            // Se comparan fechas de calendario (sin horas ni zonas horarias).
            $daysLeft = (int) round(CarbonImmutable::parse($today->toDateString(), 'UTC')
                ->diffInDays(CarbonImmutable::parse($project->end_date->toDateString(), 'UTC'), false));
            $threshold = $this->thresholdFor($daysLeft, $thresholds);
            if ($threshold === null) {
                continue;
            }

            $recipients = $this->recipients($project, $managers);
            if ($recipients->isEmpty() || ! $this->claim($project, $threshold, $recipients->count())) {
                continue;
            }

            $alerted++;
            foreach ($recipients as $user) {
                try {
                    $user->notify(new ProjectEndingSoon($project, $daysLeft));
                    $sent++;
                } catch (Throwable $e) {
                    // Un correo que falla no debe impedir avisar a los demás;
                    // la notificación de la campana se guardó antes del correo.
                    Log::warning('No se pudo enviar el aviso de vencimiento.', [
                        'project_id' => $project->getKey(),
                        'user_id' => $user->getKey(),
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        }

        return ['projects' => $alerted, 'notifications' => $sent];
    }

    /** El umbral más pequeño que ya se alcanzó (null si aún falta para el primero). */
    private function thresholdFor(int $daysLeft, array $thresholds): ?int
    {
        $reached = array_filter($thresholds, fn (int $t) => $daysLeft <= $t);

        return $reached ? min($reached) : null;
    }

    /** @return Collection<int, User> */
    private function recipients(Project $project, Collection $managers): Collection
    {
        $people = $managers->keyBy('id');
        if ($project->leader && $project->leader->is_active) {
            $people->put($project->leader->id, $project->leader);
        }

        return $people->values();
    }

    /** Registra el aviso; false si otro proceso ya lo había enviado. */
    private function claim(Project $project, int $threshold, int $recipients): bool
    {
        try {
            DB::table('project_deadline_alerts')->insert([
                'project_id' => $project->getKey(),
                'end_date' => $project->end_date->toDateString(),
                'threshold_days' => $threshold,
                'recipients' => $recipients,
                'created_at' => now(),
            ]);

            return true;
        } catch (QueryException) {
            return false; // índice único: ya se avisó este umbral
        }
    }
}
