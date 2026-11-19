<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\AlertSeverity;
use App\Enums\IncidentStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Algo que hay que atender: nace de una alerta crítica o se abre a mano. Las
 * horas que se dedican se registran en el proyecto de soporte del cliente.
 *
 * @property IncidentStatus $status
 * @property AlertSeverity $severity
 */
class Incident extends Model
{
    protected $fillable = ['title', 'severity', 'description', 'resolution'];

    protected function casts(): array
    {
        return [
            'status' => IncidentStatus::class,
            'severity' => AlertSeverity::class,
            'opened_at' => 'datetime',
            'resolved_at' => 'datetime',
        ];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    public function alerts(): HasMany
    {
        return $this->hasMany(Alert::class);
    }

    public function timeEntries(): HasMany
    {
        return $this->hasMany(TimeEntry::class);
    }
}
