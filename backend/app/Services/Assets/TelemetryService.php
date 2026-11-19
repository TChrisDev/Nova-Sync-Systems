<?php

declare(strict_types=1);

namespace App\Services\Assets;

use App\Models\Asset;
use App\Models\Client;
use App\Models\TelemetryReading;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * Sensores y series de tiempo. Las series se agrupan en bloques (por
 * ejemplo de 10 minutos) con promedio, mínimo y máximo: así un gráfico de un
 * día entero no tiene que dibujar 1.440 puntos y no se pierden los picos.
 */
class TelemetryService
{
    public const MAX_POINTS = 400;

    /** @return array<string, mixed> */
    public function sensors(Client $client): array
    {
        $sensors = Asset::query()
            ->where('client_id', $client->getKey())
            ->where('is_active', true)
            ->whereNotNull('reading_type')
            ->withCount('readings')
            ->orderBy('location')
            ->orderBy('name')
            ->get();

        $range = TelemetryReading::query()
            ->whereIn('asset_id', $sensors->pluck('id'))
            ->selectRaw('MIN(recorded_at) AS first_at, MAX(recorded_at) AS last_at, COUNT(*) AS total')
            ->first();

        return [
            'sensors' => $sensors->map(fn (Asset $a) => [
                'id' => $a->id,
                'name' => $a->name,
                'model' => $a->model,
                'location' => $a->location,
                'reading_type' => $a->reading_type,
                'reading_label' => config("nova.assets.reading_types.{$a->reading_type}.label", $a->reading_type),
                'unit' => $a->reading_unit,
                'last_status' => $a->last_status,
                'last_value' => $a->last_value,
                'last_reading_at' => $a->last_reading_at?->toIso8601String(),
                'readings' => $a->readings_count,
            ])->values(),
            'locations' => $sensors->pluck('location')->filter()->unique()->values(),
            'reading_types' => collect(config('nova.assets.reading_types'))->map(fn (array $t, string $key) => ['value' => $key, ...$t])->values(),
            'range' => [
                'from' => $range?->first_at ? CarbonImmutable::parse($range->first_at)->toIso8601String() : null,
                'to' => $range?->last_at ? CarbonImmutable::parse($range->last_at)->toIso8601String() : null,
                'readings' => (int) ($range?->total ?? 0),
            ],
        ];
    }

    /**
     * @param  Collection<int, Asset>  $assets
     * @return array<string, mixed>
     */
    public function series(Collection $assets, ?CarbonImmutable $from, ?CarbonImmutable $to, int $bucketMinutes): array
    {
        $to ??= ($assets->max('last_reading_at') ? CarbonImmutable::parse($assets->max('last_reading_at')) : CarbonImmutable::now());
        $from ??= $to->subDay();

        // Si el rango tiene demasiados bloques, se agranda el bloque.
        $minutes = max(1, (int) ceil($from->diffInMinutes($to)));
        $bucket = max($bucketMinutes, (int) ceil($minutes / self::MAX_POINTS));
        $bucketSeconds = $bucket * 60;

        $readings = TelemetryReading::query()
            ->whereIn('asset_id', $assets->pluck('id'))
            ->whereBetween('recorded_at', [$from->utc(), $to->utc()])
            ->orderBy('recorded_at')
            ->get(['asset_id', 'recorded_at', 'value', 'status']);

        $buckets = [];
        foreach ($readings as $reading) {
            $slot = intdiv($reading->recorded_at->getTimestamp(), $bucketSeconds) * $bucketSeconds;
            $buckets[$reading->asset_id][$slot][] = $reading;
        }

        return [
            'from' => $from->toIso8601String(),
            'to' => $to->toIso8601String(),
            'bucket_minutes' => $bucket,
            'series' => $assets->map(fn (Asset $asset) => [
                'asset' => ['id' => $asset->id, 'name' => $asset->name, 'location' => $asset->location, 'reading_type' => $asset->reading_type, 'unit' => $asset->reading_unit],
                'points' => collect($buckets[$asset->id] ?? [])->map(function (array $items, int $slot) {
                    $values = array_values(array_filter(array_map(fn ($r) => $r->value, $items), fn ($v) => $v !== null));

                    return [
                        'at' => CarbonImmutable::createFromTimestampUTC($slot)->toIso8601String(),
                        'avg' => $values ? round(array_sum($values) / count($values), 3) : null,
                        'min' => $values ? min($values) : null,
                        'max' => $values ? max($values) : null,
                        'count' => count($items),
                    ];
                })->values(),
            ])->values(),
        ];
    }
}
