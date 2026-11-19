<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Resources\Concerns\FormatsBusinessData;
use App\Models\Asset;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Un equipo. IP, MAC, serial y servidor de destino son información sensible
 * para la seguridad del cliente: solo salen con assets.technical (no basta
 * con ocultarlos en la pantalla).
 *
 * @mixin Asset
 */
class AssetResource extends JsonResource
{
    use FormatsBusinessData;

    public function toArray(Request $request): array
    {
        $user = $request->user();
        $technical = (bool) $user?->hasPermission('assets.technical');
        $isNetwork = $this->category->isNetwork();

        return [
            'id' => $this->id,
            'client_id' => $this->client_id,
            'client' => $this->whenLoaded('client', fn () => ['id' => $this->client->id, 'name' => $this->client->name]),
            'external_ref' => $this->external_ref,
            'name' => $this->name,
            'category' => [...$this->enumValue($this->category), 'group' => $this->category->group(), 'is_network' => $isNetwork],
            'model' => $this->model,
            'role' => $this->role,
            'criticality' => $this->enumValue($this->criticality),
            'location' => $this->location,
            'vlan' => $this->vlan,
            'monitoring' => $isNetwork ? collect(Asset::MONITORING_CONTROLS)->mapWithKeys(fn ($c) => [$c => (bool) ($this->monitoring[$c] ?? false)]) : null,
            'monitoring_count' => $isNetwork ? $this->monitoringCount() : null,
            'reading_type' => $this->reading_type,
            'reading_unit' => $this->reading_unit,
            'last_status' => $this->last_status,
            'last_value' => $this->last_value,
            'last_reading_at' => $this->last_reading_at?->toIso8601String(),
            'notes' => $this->notes,
            'is_active' => $this->is_active,
            'technical' => $technical,
            $this->mergeWhen($technical, fn () => [
                'serial' => $this->serial,
                'ip_addresses' => $this->ip_addresses ?? [],
                'mac_addresses' => $this->mac_addresses ?? [],
                'gateway' => $this->gateway,
                'iot_server' => $this->iot_server,
            ]),
            'can' => [
                'update' => (bool) $user?->hasPermission('assets.update'),
                'delete' => (bool) $user?->hasPermission('assets.delete'),
            ],
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
