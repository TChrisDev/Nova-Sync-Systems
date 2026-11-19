<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\AlertSeverity;
use App\Enums\RuleOperator;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * "Temperatura ≥ 24 °C → aviso". Una regla sin cliente aplica a todos.
 *
 * @property RuleOperator $operator
 * @property AlertSeverity $severity
 */
class AlertRule extends Model
{
    protected $fillable = ['client_id', 'name', 'reading_type', 'operator', 'threshold', 'severity', 'opens_incident', 'is_active'];

    protected function casts(): array
    {
        return [
            'operator' => RuleOperator::class,
            'severity' => AlertSeverity::class,
            'threshold' => 'float',
            'opens_incident' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function alerts(): HasMany
    {
        return $this->hasMany(Alert::class);
    }

    public function describe(string $unit = ''): string
    {
        $threshold = rtrim(rtrim(number_format($this->threshold, 3, ',', '.'), '0'), ',');

        return trim("{$this->operator->symbol()} {$threshold} {$unit}");
    }
}
