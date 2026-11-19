<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\AssetCategory;
use App\Enums\Criticality;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Un equipo de un cliente: de red, de usuario, CCTV o sensor IoT.
 *
 * @property int $id
 * @property int $client_id
 * @property string|null $external_ref
 * @property string $name
 * @property AssetCategory $category
 * @property Criticality $criticality
 * @property array<string, bool>|null $monitoring
 * @property list<string>|null $ip_addresses
 * @property list<string>|null $mac_addresses
 */
class Asset extends Model
{
    public const MONITORING_CONTROLS = ['syslog', 'snmp', 'ntp', 'ssh', 'netflow'];

    protected $fillable = [
        'name', 'category', 'model', 'serial', 'role', 'criticality', 'location', 'vlan',
        'ip_addresses', 'mac_addresses', 'gateway', 'monitoring', 'reading_type', 'reading_unit',
        'iot_server', 'notes', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'category' => AssetCategory::class,
            'criticality' => Criticality::class,
            'ip_addresses' => 'array',
            'mac_addresses' => 'array',
            'monitoring' => 'array',
            'last_value' => 'float',
            'last_reading_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function readings(): HasMany
    {
        return $this->hasMany(TelemetryReading::class);
    }

    public function alerts(): HasMany
    {
        return $this->hasMany(Alert::class);
    }

    /** Controles de monitoreo configurados (solo cuenta en equipos de red). */
    public function monitoringCount(): int
    {
        return count(array_filter(array_intersect_key($this->monitoring ?? [], array_flip(self::MONITORING_CONTROLS))));
    }
}
