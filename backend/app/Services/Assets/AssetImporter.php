<?php

declare(strict_types=1);

namespace App\Services\Assets;

use App\Enums\AssetCategory;
use App\Enums\Criticality;
use App\Models\Asset;
use App\Models\AssetLink;
use App\Models\Client;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Support\BusinessCalendar;
use App\Support\Xlsx\XlsxReader;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * Importa el inventario y la telemetría de un cliente desde Excel.
 *
 * Reconoce dos tipos de libro por sus encabezados (no por el nombre del
 * archivo):
 *
 * - Inventario de red: una hoja con Nombre, Categoría y Criticidad; si hay,
 *   la hoja de controles de monitoreo (NetFlow, Syslog, SNMP, NTP, SSH) y la
 *   de enlaces (Origen y Destino).
 * - IoT: una hoja de dispositivos (ID Dispositivo, Tipo Lectura) y una de
 *   registros (ID Registro, Timestamp, Valor).
 *
 * Volver a importar el mismo archivo actualiza; no duplica. En modo de
 * prueba todo se ejecuta dentro de una transacción que se deshace al final,
 * así el resumen es exactamente lo que pasaría al confirmar.
 */
class AssetImporter
{
    private const MAX_WARNINGS = 60;

    /** @var list<string> */
    private array $warnings = [];

    /** @var array<string, int> */
    private array $counts = [];

    public function __construct(
        private readonly AlertEngine $alerts,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  list<string>  $paths  archivos .xlsx (uno o varios)
     * @return array<string, mixed>
     */
    public function run(Client $client, array $paths, bool $dryRun, ?User $actor = null, array $names = []): array
    {
        $this->warnings = [];
        $this->counts = array_fill_keys(['assets_created', 'assets_updated', 'links_created', 'links_updated', 'readings_created', 'readings_existing', 'alerts', 'incidents', 'rules_created'], 0);

        $books = [];
        foreach ($paths as $index => $path) {
            $books[] = [new XlsxReader($path), $names[$index] ?? basename($path)];
        }

        DB::beginTransaction();
        try {
            $recognized = [];
            foreach ($books as [$book, $name]) {
                $kinds = $this->importBook($client, $book, $actor);
                $recognized[] = ['file' => $name, 'kinds' => $kinds];
                if (! $kinds) {
                    $this->warn("«{$name}» no tiene hojas de inventario ni de IoT reconocibles; no se importó nada de ese archivo.");
                }
            }

            if ($this->counts['readings_created'] > 0 || $this->counts['assets_created'] > 0) {
                $this->counts['rules_created'] = $this->alerts->ensureDefaultRules($client, $actor);
            }
            $evaluation = $this->alerts->evaluate($client, $actor);
            $this->counts['alerts'] = $evaluation['alerts'];
            $this->counts['incidents'] = $evaluation['incidents'];

            $summary = [
                'dry_run' => $dryRun,
                'client' => ['id' => $client->id, 'name' => $client->name],
                'files' => $recognized,
                'counts' => $this->counts,
                'warnings' => $this->warnings,
            ];

            if ($dryRun) {
                DB::rollBack();
            } else {
                $this->audit->log('assets.imported', $actor, $client, ['files' => array_column($recognized, 'file'), 'counts' => $this->counts]);
                DB::commit();
            }

            return $summary;
        } catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** @return list<string> tipos reconocidos: inventory, monitoring, links, iot_devices, iot_readings */
    private function importBook(Client $client, XlsxReader $book, ?User $actor): array
    {
        $kinds = [];
        $sheets = [];
        foreach ($book->sheetNames() as $sheet) {
            $sheets[$sheet] = $book->rows($sheet);
        }

        // Orden: equipos primero (los enlaces y lecturas los necesitan).
        foreach ($sheets as $name => $rows) {
            if ($table = $this->table($rows, ['nombre', 'categoria', 'criticidad'])) {
                $this->importInventory($client, $table, $actor);
                $kinds[] = 'inventory';
            }
        }
        foreach ($sheets as $name => $rows) {
            foreach ($this->tables($rows, ['id dispositivo', 'tipo lectura']) as $table) {
                $this->importIotDevices($client, $table, $actor);
                $kinds[] = 'iot_devices';
            }
            if ($table = $this->table($rows, ['servidor', 'direccion ip', 'rol en arquitectura'])) {
                $this->importServers($client, $table, $actor);
            }
        }
        foreach ($sheets as $name => $rows) {
            if ($table = $this->table($rows, ['equipo', 'netflow', 'syslog', 'snmp'])) {
                $this->importMonitoring($client, $table);
                $kinds[] = 'monitoring';
            }
            if ($table = $this->table($rows, ['origen', 'destino', 'tipo link'])) {
                $this->importLinks($client, $table);
                $kinds[] = 'links';
            }
            if ($table = $this->table($rows, ['id registro', 'timestamp', 'id dispositivo'])) {
                $this->importReadings($client, $table);
                $kinds[] = 'iot_readings';
            }
        }

        return array_values(array_unique($kinds));
    }

    /** @param  list<array<string, string|null>>  $rows */
    private function importInventory(Client $client, array $rows, ?User $actor): void
    {
        foreach ($rows as $line => $row) {
            $name = $row['nombre'] ?? null;
            if (! $name) {
                $this->warn('Inventario, fila '.($line + 2).': sin nombre, se omitió.');

                continue;
            }

            $ref = 'inv:'.($row['id'] ?? $name);
            // La categoría del archivo manda; el tipo de Packet Tracer solo
            // desempata cuando la categoría no se reconoce.
            $category = $this->category((string) ($row['categoria'] ?? ''));
            if ($category === AssetCategory::Other) {
                $category = $this->category((string) ($row['tipo pt'] ?? ''));
            }
            $this->upsertAsset($client, $ref, [
                'name' => $name,
                'category' => $category,
                'model' => $row['modelo'] ?? null,
                'serial' => $row['serial'] ?? null,
                'role' => $row['rol inferido'] ?? $row['rol'] ?? null,
                'criticality' => $this->criticality($row['criticidad'] ?? null),
                'ip_addresses' => $this->list($row['ip(s)'] ?? $row['ip'] ?? null),
                'mac_addresses' => $this->list($row['mac(s)'] ?? $row['mac'] ?? null),
                'gateway' => $this->list($row['gateway(s)'] ?? null)[0] ?? null,
            ], $actor);
        }
    }

    /** @param  list<array<string, string|null>>  $rows */
    private function importIotDevices(Client $client, array $rows, ?User $actor): void
    {
        foreach ($rows as $line => $row) {
            $id = $row['id dispositivo'] ?? null;
            $name = $row['nombre topologia'] ?? $row['nombre'] ?? $id;
            if (! $id) {
                continue;
            }

            $type = strtoupper((string) ($row['tipo lectura'] ?? ''));
            $this->upsertAsset($client, 'iot:'.$id, [
                'name' => $name,
                'category' => $this->category((string) ($row['tipo de dispositivo'] ?? ''), AssetCategory::Sensor),
                'model' => $row['tipo de dispositivo'] ?? null,
                'criticality' => $type === 'SMOKE' ? Criticality::High : Criticality::Medium,
                'location' => $row['ubicacion / oficina'] ?? $row['ubicacion'] ?? null,
                'vlan' => $row['vlan asignada'] ?? null,
                'ip_addresses' => $this->list($row['direccion ip'] ?? null),
                'mac_addresses' => $this->list($row['direccion mac'] ?? null),
                'gateway' => $row['default gateway'] ?? null,
                'iot_server' => $row['servidor iot target'] ?? null,
                'reading_type' => $type ?: null,
                'reading_unit' => $row['unidad'] ?? null,
                'role' => 'Sensor · '.($row['tipo de dispositivo'] ?? 'IoT'),
            ], $actor);
        }
    }

    /** @param  list<array<string, string|null>>  $rows */
    private function importServers(Client $client, array $rows, ?User $actor): void
    {
        foreach ($rows as $row) {
            if (! ($name = $row['servidor'] ?? null)) {
                continue;
            }
            $this->upsertAsset($client, 'iot:'.$name, [
                'name' => $name,
                'category' => AssetCategory::Server,
                'criticality' => Criticality::High,
                'role' => $row['rol en arquitectura'] ?? null,
                'vlan' => $row['vlan / funcion'] ?? null,
                'ip_addresses' => $this->list($row['direccion ip'] ?? null),
            ], $actor);
        }
    }

    /** @param  list<array<string, string|null>>  $rows */
    private function importMonitoring(Client $client, array $rows): void
    {
        foreach ($rows as $row) {
            $asset = $this->byName($client, $row['equipo'] ?? null);
            if (! $asset) {
                $this->warn('Monitoreo: el equipo «'.($row['equipo'] ?? '?').'» no está en el inventario.');

                continue;
            }

            $current = $asset->monitoring ?? [];
            foreach (Asset::MONITORING_CONTROLS as $control) {
                $value = $row[$control] ?? $row["{$control} config"] ?? null;
                if ($value !== null) {
                    $current[$control] = $this->yes($value);
                }
            }
            $asset->forceFill(['monitoring' => $current])->save();
        }
    }

    /** @param  list<array<string, string|null>>  $rows */
    private function importLinks(Client $client, array $rows): void
    {
        foreach ($rows as $line => $row) {
            $source = $this->byName($client, $row['origen'] ?? null);
            $target = $this->byName($client, $row['destino'] ?? null);
            if (! $source || ! $target) {
                $this->warn('Enlaces, fila '.($line + 2).': «'.($row['origen'] ?? '?').'» o «'.($row['destino'] ?? '?').'» no están en el inventario.');

                continue;
            }

            $ref = 'link:'.($row['id'] ?? ($line + 1));
            $link = AssetLink::query()->where('client_id', $client->getKey())->where('external_ref', $ref)->first();
            $this->counts[$link ? 'links_updated' : 'links_created']++;

            ($link ?? new AssetLink)->forceFill([
                'client_id' => $client->getKey(),
                'external_ref' => $ref,
                'source_asset_id' => $source->id,
                'source_port' => $row['puerto origen'] ?? null,
                'target_asset_id' => $target->id,
                'target_port' => $row['puerto destino'] ?? null,
                'link_type' => $row['tipo link'] ?? null,
                'cable_type' => $row['tipo cable'] ?? null,
                'is_functional' => isset($row['funcional']) ? $this->yes($row['funcional']) : null,
                'criticality' => isset($row['criticidad sugerida']) ? $this->criticality($row['criticidad sugerida'])->value : null,
            ])->save();
        }
    }

    /** @param  list<array<string, string|null>>  $rows */
    private function importReadings(Client $client, array $rows): void
    {
        $assets = Asset::query()->where('client_id', $client->getKey())->where('external_ref', 'like', 'iot:%')->pluck('id', 'external_ref');
        $missing = [];
        $batch = [];
        $now = now();

        foreach ($rows as $line => $row) {
            $device = $row['id dispositivo'] ?? null;
            $assetId = $assets->get('iot:'.$device);
            if (! $assetId) {
                $missing[$device ?? '?'] = true;

                continue;
            }

            $at = $this->timestamp($row['timestamp'] ?? null);
            if (! $at) {
                $this->warn('Registros, fila '.($line + 2).': fecha «'.($row['timestamp'] ?? '').'» no reconocida.');

                continue;
            }

            $value = $row['valor valor'] ?? $row['valor'] ?? null;
            $batch[] = [
                'asset_id' => $assetId,
                'recorded_at' => $at->utc()->format('Y-m-d H:i:s'),
                'status' => mb_substr(strtoupper((string) ($row['estado sensor'] ?? $row['estado'] ?? 'N/D')), 0, 20),
                'value' => is_numeric($value) ? (float) $value : null,
                'unit' => isset($row['unidad']) ? mb_substr($row['unidad'], 0, 10) : null,
                'note' => isset($row['observacion / alerta']) ? mb_substr($row['observacion / alerta'], 0, 200) : null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        foreach ($missing as $device => $_) {
            $this->warn("Registros: el dispositivo «{$device}» no está en la hoja de dispositivos; sus lecturas se omitieron.");
        }

        foreach (array_chunk($batch, 500) as $chunk) {
            $inserted = DB::table('telemetry_readings')->insertOrIgnore($chunk);
            $this->counts['readings_created'] += $inserted;
            $this->counts['readings_existing'] += count($chunk) - $inserted;
        }

        $this->refreshLastReadings($client);
    }

    /** Último estado de cada sensor, para las tarjetas de telemetría. */
    private function refreshLastReadings(Client $client): void
    {
        $assets = Asset::query()->where('client_id', $client->getKey())->whereNotNull('reading_type')->get();
        foreach ($assets as $asset) {
            $last = $asset->readings()->orderByDesc('recorded_at')->first();
            if ($last) {
                $asset->forceFill(['last_status' => $last->status, 'last_value' => $last->value, 'last_reading_at' => $last->recorded_at])->save();
            }
        }
    }

    /** @param  array<string, mixed>  $data */
    private function upsertAsset(Client $client, string $ref, array $data, ?User $actor): Asset
    {
        $ref = mb_substr($ref, 0, 60);
        $asset = Asset::query()->where('client_id', $client->getKey())->where('external_ref', $ref)->first();
        $this->counts[$asset ? 'assets_updated' : 'assets_created']++;

        $asset ??= new Asset;
        $clean = array_map(fn ($v) => is_string($v) ? mb_substr(trim($v), 0, 120) : $v, $data);
        $asset->fill(array_filter($clean, fn ($v) => $v !== null));
        $asset->forceFill([
            'client_id' => $client->getKey(),
            'external_ref' => $ref,
            'is_active' => true,
            'created_by' => $asset->exists ? $asset->created_by : $actor?->getKey(),
        ])->save();

        return $asset;
    }

    private function byName(Client $client, ?string $name): ?Asset
    {
        if (! $name) {
            return null;
        }

        // Solo equipos del inventario de red: el archivo de IoT puede repetir
        // nombres ("IoT13") de otra topología.
        return Asset::query()
            ->where('client_id', $client->getKey())
            ->where('name', trim($name))
            ->where('external_ref', 'like', 'inv:%')
            ->orderBy('id')
            ->first();
    }

    /**
     * Encuentra la tabla cuyo encabezado contiene las columnas pedidas y la
     * devuelve como filas asociativas (encabezado normalizado => valor).
     *
     * @param  list<list<string|null>>  $rows
     * @param  list<string>  $required
     * @return list<array<string, string|null>>|null
     */
    private function table(array $rows, array $required): ?array
    {
        return $this->tables($rows, $required)[0] ?? null;
    }

    /**
     * Una hoja puede tener varias tablas (la de IoT trae dispositivos y,
     * debajo, servidores): cada encabezado empieza una tabla nueva.
     *
     * @return list<list<array<string, string|null>>>
     */
    private function tables(array $rows, array $required): array
    {
        $tables = [];
        $header = null;
        $current = [];

        foreach ($rows as $row) {
            $normalized = array_map(fn ($v) => $v === null ? null : self::normalize($v), $row);
            $filled = array_values(array_filter($row, fn ($v) => $v !== null && $v !== ''));

            if (count(array_intersect($required, array_filter($normalized))) === count($required)) {
                if ($header !== null && $current !== []) {
                    $tables[] = $current;
                }
                $header = $normalized;
                $current = [];

                continue;
            }

            if ($header === null) {
                continue;
            }

            // Una fila con un solo texto después de datos es el título de otra
            // sección ("RESUMEN DE SERVIDORES"): ahí termina esta tabla.
            if (count($filled) === 1 && $current !== [] && ! is_numeric($filled[0])) {
                $tables[] = $current;
                $header = null;
                $current = [];

                continue;
            }

            $assoc = [];
            foreach ($header as $i => $key) {
                if ($key !== null && $key !== '') {
                    $assoc[$key] = $row[$i] ?? null;
                }
            }
            $current[] = $assoc;
        }

        if ($header !== null && $current !== []) {
            $tables[] = $current;
        }

        return $tables;
    }

    public static function normalize(string $text): string
    {
        $ascii = strtr(mb_strtolower(trim($text)), ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);

        return (string) preg_replace('/\s+/', ' ', $ascii);
    }

    private function category(string $text, AssetCategory $fallback = AssetCategory::Other): AssetCategory
    {
        $t = self::normalize($text);

        return match (true) {
            str_contains($t, 'firewall') || preg_match('/\\basa\\b/', $t) === 1 => AssetCategory::Firewall,
            str_contains($t, 'router') => AssetCategory::Router,
            str_contains($t, 'capa 3') || str_contains($t, 'multilayer') || str_contains($t, ' l3') => AssetCategory::CoreSwitch,
            str_contains($t, 'switch') => AssetCategory::AccessSwitch,
            str_contains($t, 'servidor') || str_contains($t, 'server') => AssetCategory::Server,
            str_contains($t, 'laptop') || str_contains($t, 'portatil') => AssetCategory::Laptop,
            str_contains($t, 'mcu') => AssetCategory::Controller,
            str_contains($t, 'cctv') || str_contains($t, 'camara') || str_contains($t, 'webcam') => AssetCategory::Camera,
            str_contains($t, 'iot') || str_contains($t, 'sensor') || str_contains($t, 'detector') || str_contains($t, 'monitor') || str_contains($t, 'door') || str_contains($t, 'humid') || str_contains($t, 'heating') => AssetCategory::Sensor,
            preg_match('/\bpc\b/', $t) === 1 => AssetCategory::Desktop,
            str_contains($t, 'power') || str_contains($t, 'ups') || str_contains($t, 'energ') => AssetCategory::Power,
            default => $fallback,
        };
    }

    private function criticality(?string $text): Criticality
    {
        $t = self::normalize((string) $text);

        return match (true) {
            str_starts_with($t, 'crit') => Criticality::Critical,
            str_starts_with($t, 'alt') || $t === 'high' => Criticality::High,
            str_starts_with($t, 'baj') || $t === 'low' => Criticality::Low,
            default => Criticality::Medium,
        };
    }

    private function yes(string $value): bool
    {
        return in_array(self::normalize($value), ['si', 'sí', 'yes', 'true', '1', 'x'], true);
    }

    /** "10.0.0.2; 10.0.0.9" → ["10.0.0.2", "10.0.0.9"] (como máximo 64) */
    private function list(?string $value): ?array
    {
        if ($value === null || trim($value) === '') {
            return null;
        }
        $items = array_values(array_filter(array_map('trim', preg_split('/[;,\n]+/', $value) ?: [])));

        return array_slice(array_map(fn ($v) => mb_substr($v, 0, 45), $items), 0, 64) ?: null;
    }

    /** Texto "2026-09-13 08:01:00" o número de serie de Excel, en hora de Colombia. */
    private function timestamp(?string $value): ?CarbonImmutable
    {
        if ($value === null) {
            return null;
        }
        $zone = BusinessCalendar::timezone();

        if (is_numeric($value) && (float) $value > 20000) {
            // Días desde 1899-12-30 (así cuenta Excel).
            return CarbonImmutable::create(1899, 12, 30, 0, 0, 0, $zone)->addSeconds((int) round((float) $value * 86400));
        }

        foreach (['Y-m-d H:i:s', 'Y-m-d H:i', 'd/m/Y H:i:s', 'd/m/Y H:i', 'Y-m-d\TH:i:s'] as $format) {
            try {
                $parsed = CarbonImmutable::createFromFormat($format, trim($value), $zone);
                if ($parsed !== null) {
                    return $parsed;
                }
            } catch (Throwable) {
                // probar el siguiente formato
            }
        }

        return null;
    }

    private function warn(string $message): void
    {
        if (count($this->warnings) < self::MAX_WARNINGS) {
            $this->warnings[] = $message;
        } elseif (count($this->warnings) === self::MAX_WARNINGS) {
            $this->warnings[] = 'Hay más avisos; se muestran los primeros '.self::MAX_WARNINGS.'.';
        }
    }

    /** Valida extensión y tamaño antes de abrir un archivo subido. */
    public static function assertReadable(string $path): void
    {
        if (! is_file($path) || filesize($path) === 0) {
            throw new RuntimeException('El archivo está vacío.');
        }
    }
}
