<?php

namespace App\Notifications;

use App\Models\Project;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Aviso de que un proyecto está por llegar a su fecha de fin. Va siempre a
 * la campana de la aplicación y, si la persona no lo desactivó en su
 * cuenta, también por correo.
 */
class ProjectEndingSoon extends Notification
{
    use Queueable;

    public const KIND = 'project_ending';

    public function __construct(
        public readonly Project $project,
        public readonly int $daysLeft,
    ) {}

    /** @return list<string> */
    public function via(User $notifiable): array
    {
        return $notifiable->notify_by_email ? ['database', 'mail'] : ['database'];
    }

    public function title(): string
    {
        return match (true) {
            $this->daysLeft <= 0 => "El proyecto {$this->project->code} vence hoy",
            $this->daysLeft === 1 => "El proyecto {$this->project->code} vence mañana",
            default => "El proyecto {$this->project->code} vence en {$this->daysLeft} días",
        };
    }

    public function body(): string
    {
        $date = $this->project->end_date?->locale('es')->isoFormat('D [de] MMMM [de] YYYY');

        return "{$this->project->name} termina el {$date}. Revisa si hay que cerrarlo, extender la fecha o renovar el contrato.";
    }

    public function path(): string
    {
        return "/app/projects/{$this->project->getKey()}";
    }

    /** Lo que guarda la campana (canal database). */
    public function toArray(User $notifiable): array
    {
        return [
            'kind' => self::KIND,
            'title' => $this->title(),
            'body' => $this->body(),
            'url' => $this->path(),
            'project_id' => $this->project->getKey(),
            'end_date' => $this->project->end_date?->toDateString(),
            'days_left' => $this->daysLeft,
        ];
    }

    public function toMail(User $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject($this->title())
            ->greeting('Hola, '.strtok($notifiable->name, ' '))
            ->line($this->body())
            ->action('Ver el proyecto', config('nova.frontend_url').$this->path())
            ->line('Recibes este aviso porque lideras el proyecto o administras proyectos en Nova Sync Systems. Puedes desactivar los correos en Configuración de cuenta.')
            ->salutation('Nova Sync Systems');
    }
}
