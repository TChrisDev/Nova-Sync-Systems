<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\AlertSeverity;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Una lectura que cumplió una regla. Puede quedar asociada a un incidente. */
class Alert extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['triggered_at' => 'datetime', 'value' => 'float', 'severity' => AlertSeverity::class];
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function rule(): BelongsTo
    {
        return $this->belongsTo(AlertRule::class, 'alert_rule_id');
    }

    public function reading(): BelongsTo
    {
        return $this->belongsTo(TelemetryReading::class, 'telemetry_reading_id');
    }

    public function incident(): BelongsTo
    {
        return $this->belongsTo(Incident::class);
    }
}
