<?php

declare(strict_types=1);

namespace App\Services\Assets;

use App\Models\Asset;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use Illuminate\Support\Facades\DB;

/** Alta, edición y baja manual de equipos, con su rastro en la auditoría. */
class AssetService
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** @param  array<string, mixed>  $data */
    public function create(User $actor, array $data): Asset
    {
        return DB::transaction(function () use ($actor, $data) {
            $asset = new Asset($this->normalize($data));
            $asset->forceFill(['client_id' => $data['client_id'], 'created_by' => $actor->getKey(), 'is_active' => $data['is_active'] ?? true])->save();
            $this->audit->log('asset.created', $actor, $asset, ['name' => $asset->name, 'client_id' => $asset->client_id]);

            return $asset;
        });
    }

    /** @param  array<string, mixed>  $data */
    public function update(User $actor, Asset $asset, array $data): Asset
    {
        return DB::transaction(function () use ($actor, $asset, $data) {
            $asset->fill($this->normalize($data));
            $changes = array_keys($asset->getDirty());
            $asset->save();
            $this->audit->log('asset.updated', $actor, $asset, ['name' => $asset->name, 'fields' => $changes]);

            return $asset;
        });
    }

    public function delete(User $actor, Asset $asset): void
    {
        DB::transaction(function () use ($actor, $asset) {
            $this->audit->log('asset.deleted', $actor, $asset, ['name' => $asset->name, 'client_id' => $asset->client_id, 'readings' => $asset->readings()->count()]);
            $asset->delete();
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function normalize(array $data): array
    {
        $fields = array_intersect_key($data, array_flip((new Asset)->getFillable()));

        foreach (['ip_addresses', 'mac_addresses'] as $key) {
            if (array_key_exists($key, $fields)) {
                $fields[$key] = $fields[$key] ? array_values(array_filter(array_map('trim', (array) $fields[$key]))) : null;
            }
        }

        if (array_key_exists('monitoring', $fields) && is_array($fields['monitoring'])) {
            $fields['monitoring'] = collect(Asset::MONITORING_CONTROLS)->mapWithKeys(fn ($c) => [$c => (bool) ($fields['monitoring'][$c] ?? false)])->all();
        }

        return $fields;
    }
}
