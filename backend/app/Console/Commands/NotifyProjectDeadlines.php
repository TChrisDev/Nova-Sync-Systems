<?php

namespace App\Console\Commands;

use App\Services\Notifications\ProjectDeadlineNotifier;
use Illuminate\Console\Command;

class NotifyProjectDeadlines extends Command
{
    protected $signature = 'nova:notify-project-deadlines';

    protected $description = 'Avisa (en la aplicación y por correo) los proyectos que están por llegar a su fecha de fin.';

    public function handle(ProjectDeadlineNotifier $notifier): int
    {
        $result = $notifier->run();

        $this->info("Proyectos avisados: {$result['projects']}. Notificaciones enviadas: {$result['notifications']}.");

        return self::SUCCESS;
    }
}
