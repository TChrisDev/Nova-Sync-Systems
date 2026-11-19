<?php

declare(strict_types=1);

namespace App\Services\Assets;

use App\Enums\AlertSeverity;
use App\Enums\AssetCategory;
use App\Enums\Criticality;
use App\Enums\IncidentStatus;
use App\Models\Alert;
use App\Models\Asset;
use App\Models\AssetLink;
use App\Models\Client;
use App\Models\Incident;
use App\Support\BusinessCalendar;
use Illuminate\Support\Collection;

/**
 * Cálculos del panel técnico, el mapa de red y la cobertura de monitoreo.
 * Todo sale de los datos guardados: nada de cifras de ejemplo.
 */
class AssetInsights
{
    /** @return array<string, mixed> */
    public function dashboard(Client $client): array
    {
        $assets = Asset::query()->where('client_id', $client->getKey())->where('is_active', true)->get();
        $network = $assets->filter(fn (Asset $a) => $a->category->isNetwork());
        $coverage = $this->coverageSummary($network);

        $byCategory = $assets->groupBy(fn (Asset $a) => $a->category->value)
            ->map(fn (Collection $items, string $category) => ['value' => $category, 'label' => AssetCategory::from($category)->label(), 'count' => $items->count()])
            ->sortByDesc('count')->values();

        $byGroup = collect(AssetCategory::groupLabels())->map(fn (string $label, string $group) => [
            'value' => $group,
            'label' => $label,
            'count' => $assets->filter(fn (Asset $a) => $a->category->group() === $group)->count(),
        ])->values();

        $alerts = Alert::query()->where('client_id', $client->getKey());
        $lastReading = $assets->max('last_reading_at');

        return [
            'totals' => [
                'assets' => $assets->count(),
                'critical' => $assets->where('criticality', Criticality::Critical)->count(),
                'high' => $assets->where('criticality', Criticality::High)->count(),
                'sensors' => $assets->whereNotNull('reading_type')->count(),
                'links' => AssetLink::query()->where('client_id', $client->getKey())->count(),
            ],
            'by_group' => $byGroup,
            'by_category' => $byCategory,
            'by_criticality' => collect(Criticality::cases())->map(fn (Criticality $c) => [
                'value' => $c->value,
                'label' => $c->label(),
                'count' => $assets->where('criticality', $c)->count(),
            ])->values(),
            'critical_assets' => $assets->where('criticality', Criticality::Critical)->map(fn (Asset $a) => ['id' => $a->id, 'name' => $a->name, 'category' => $a->category->label(), 'role' => $a->role])->values(),
            'coverage' => $coverage,
            'alerts' => [
                'total' => (clone $alerts)->count(),
                'by_severity' => collect(AlertSeverity::cases())->map(fn (AlertSeverity $s) => ['value' => $s->value, 'label' => $s->label(), 'count' => (clone $alerts)->where('severity', $s->value)->count()])->values(),
                'recent' => $this->recentAlerts($client, 6),
                'timeline' => $this->alertTimeline($client),
            ],
            'incidents' => [
                'open' => Incident::query()->where('client_id', $client->getKey())->whereIn('status', [IncidentStatus::Open->value, IncidentStatus::InProgress->value])->count(),
                'total' => Incident::query()->where('client_id', $client->getKey())->count(),
            ],
            'last_reading_at' => $lastReading ? \Carbon\CarbonImmutable::parse($lastReading)->toIso8601String() : null,
        ];
    }

    /**
     * Alertas en el tiempo por severidad, en hora de Colombia. El intervalo
     * se ajusta a lo que abarcan los datos: 15 minutos hasta 6 horas, una
     * hora hasta 2 días y un día en adelante. Los intervalos sin alertas van
     * en cero para que el gráfico muestre los huecos.
     *
     * @return array{bucket_minutes: int, points: list<array<string, mixed>>}
     */
    public function alertTimeline(Client $client): array
    {
        $tz = BusinessCalendar::timezone();
        $rows = Alert::query()->where('client_id', $client->getKey())->orderBy('triggered_at')->get(['triggered_at', 'severity']);
        if ($rows->isEmpty()) {
            return ['bucket_minutes' => 60, 'points' => []];
        }

        $first = $rows->first()->triggered_at->toImmutable()->setTimezone($tz);
        $last = $rows->last()->triggered_at->toImmutable()->setTimezone($tz);
        $span = $first->diffInMinutes($last);
        $size = $span <= 360 ? 15 : ($span <= 2880 ? 60 : 1440);
        $floor = fn ($t) => $size === 1440 ? $t->startOfDay() : $t->startOfHour()->addMinutes(intdiv($t->minute, $size) * $size);

        // Como máximo 60 barras: si hay más, se muestran las más recientes.
        $end = $floor($last);
        $start = $floor($first);
        if ($start->diffInMinutes($end) / $size >= 60) {
            $start = $end->subMinutes(59 * $size);
        }

        $severities = array_map(fn (AlertSeverity $s) => $s->value, AlertSeverity::cases());
        $points = [];
        for ($t = $start; $t <= $end; $t = $t->addMinutes($size)) {
            $points[$t->format('Y-m-d H:i')] = ['at' => $t->toIso8601String()] + array_fill_keys($severities, 0);
        }

        foreach ($rows as $alert) {
            $key = $floor($alert->triggered_at->toImmutable()->setTimezone($tz))->format('Y-m-d H:i');
            if (isset($points[$key])) {
                $points[$key][$alert->severity->value]++;
            }
        }

        return ['bucket_minutes' => $size, 'points' => array_values($points)];
    }

    /** @return list<array<string, mixed>> */
    public function recentAlerts(Client $client, int $limit): array
    {
        // Una fila por regla y minuto: tres sensores en el mismo minuto se leen como un evento.
        return Alert::query()
            ->with(['asset:id,name,location', 'rule:id,name,reading_type'])
            ->where('client_id', $client->getKey())
            ->orderByDesc('triggered_at')
            ->orderByDesc('id')
            ->limit(200)
            ->get()
            ->groupBy(fn (Alert $a) => $a->alert_rule_id.'|'.$a->triggered_at->format('Y-m-d H:i'))
            ->take($limit)
            ->map(function (Collection $group) {
                $first = $group->first();

                return [
                    'rule' => $first->rule->name,
                    'severity' => ['value' => $first->severity->value, 'label' => $first->severity->label()],
                    'triggered_at' => $first->triggered_at->toIso8601String(),
                    'value' => $first->value,
                    'unit' => config("nova.assets.reading_types.{$first->rule->reading_type}.unit"),
                    'assets' => $group->pluck('asset.name')->unique()->values(),
                    'locations' => $group->pluck('asset.location')->filter()->unique()->values(),
                    'incident_id' => $first->incident_id,
                ];
            })
            ->values()
            ->all();
    }

    /** @return array<string, mixed> */
    public function coverage(Client $client): array
    {
        $network = Asset::query()->where('client_id', $client->getKey())->where('is_active', true)->get()
            ->filter(fn (Asset $a) => $a->category->isNetwork())
            ->sortBy(fn (Asset $a) => [$a->category->layer(), $a->name])
            ->values();

        return [
            'summary' => $this->coverageSummary($network),
            'controls' => collect(config('nova.assets.monitoring_controls'))->map(fn (array $c, string $key) => ['value' => $key, ...$c])->values(),
            'assets' => $network->map(fn (Asset $a) => [
                'id' => $a->id,
                'name' => $a->name,
                'category' => ['value' => $a->category->value, 'label' => $a->category->label()],
                'criticality' => ['value' => $a->criticality->value, 'label' => $a->criticality->label()],
                'role' => $a->role,
                'monitoring' => collect(Asset::MONITORING_CONTROLS)->mapWithKeys(fn ($c) => [$c => (bool) ($a->monitoring[$c] ?? false)]),
                'configured' => $a->monitoringCount(),
            ])->values(),
        ];
    }

    /** @return array<string, mixed> */
    private function coverageSummary(Collection $network): array
    {
        $controls = Asset::MONITORING_CONTROLS;
        $possible = $network->count() * count($controls);
        $configured = $network->sum(fn (Asset $a) => $a->monitoringCount());

        return [
            'devices' => $network->count(),
            'possible' => $possible,
            'configured' => $configured,
            'ratio' => $possible ? round($configured / $possible, 4) : null,
            'by_control' => collect($controls)->map(fn (string $c) => [
                'value' => $c,
                'label' => config("nova.assets.monitoring_controls.{$c}.label"),
                'configured' => $network->filter(fn (Asset $a) => (bool) ($a->monitoring[$c] ?? false))->count(),
                'devices' => $network->count(),
            ])->values(),
            'without_any' => $network->filter(fn (Asset $a) => $a->monitoringCount() === 0)->count(),
        ];
    }

    /**
     * Mapa: equipos de red por capas (WAN → perímetro → núcleo → acceso), sus
     * enlaces entre ellos y cuántos equipos cuelgan de cada uno.
     *
     * @return array<string, mixed>
     */
    public function map(Client $client, bool $technical): array
    {
        $assets = Asset::query()->where('client_id', $client->getKey())->where('is_active', true)->get()->keyBy('id');
        $links = AssetLink::query()->where('client_id', $client->getKey())->get();
        $network = $assets->filter(fn (Asset $a) => $a->category->layer() !== null);

        $edges = [];
        $endpoints = [];
        foreach ($links as $link) {
            $a = $assets->get($link->source_asset_id);
            $b = $assets->get($link->target_asset_id);
            if (! $a || ! $b) {
                continue;
            }

            $aNet = $network->has($a->id);
            $bNet = $network->has($b->id);
            if ($aNet && $bNet) {
                $edges[] = ['source' => $a->id, 'target' => $b->id, 'functional' => $link->is_functional, 'criticality' => $link->criticality, 'ports' => trim(($link->source_port ?? '').' → '.($link->target_port ?? ''), ' →')];
            } elseif ($aNet xor $bNet) {
                $hub = $aNet ? $a : $b;
                $device = $aNet ? $b : $a;
                $endpoints[$hub->id][$device->category->group()] = ($endpoints[$hub->id][$device->category->group()] ?? 0) + 1;
            }
        }

        // Punto único de falla: un equipo de red por el que pasa toda una capa
        // hacia Internet (un solo firewall entre los routers y el núcleo, por ejemplo).
        $layers = $network->groupBy(fn (Asset $a) => $a->category->layer());

        return [
            'nodes' => $network->values()->map(fn (Asset $a) => [
                'id' => $a->id,
                'name' => $a->name,
                'layer' => $a->category->layer(),
                'category' => ['value' => $a->category->value, 'label' => $a->category->label()],
                'criticality' => ['value' => $a->criticality->value, 'label' => $a->criticality->label()],
                'model' => $a->model,
                'role' => $a->role,
                'ip' => $technical ? ($a->ip_addresses[0] ?? null) : null,
                'endpoints' => $endpoints[$a->id] ?? [],
                'endpoint_total' => array_sum($endpoints[$a->id] ?? []),
                'monitoring' => $a->monitoringCount(),
            ])->all(),
            'edges' => $edges,
            'single_points' => $layers->filter(fn (Collection $items, int $layer) => $items->count() === 1 && $layer > 0 && $layer < 3)
                ->map(fn (Collection $items) => ['id' => $items->first()->id, 'name' => $items->first()->name, 'category' => $items->first()->category->label()])
                ->values(),
            'totals' => [
                'links' => $links->count(),
                'network_links' => count($edges),
                'functional' => $links->where('is_functional', true)->count(),
            ],
        ];
    }
}
