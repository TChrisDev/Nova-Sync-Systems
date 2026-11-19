<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Client;
use App\Services\Assets\AssetImporter;
use Illuminate\Console\Command;
use RuntimeException;

/**
 * Importa inventario y telemetría desde Excel por consola. Lo mismo que el
 * botón «Importar desde Excel» del inventario, útil para cargas grandes.
 *
 *   php artisan nova:import-assets CLI-012 inventario.xlsx iot.xlsx --dry-run
 */
class ImportAssets extends Command
{
    protected $signature = 'nova:import-assets
                            {client : Código (CLI-012) o id del cliente}
                            {files* : Uno o varios archivos .xlsx}
                            {--dry-run : Muestra el resumen sin guardar}';

    protected $description = 'Importa equipos, enlaces, controles de monitoreo y lecturas IoT desde Excel';

    public function handle(AssetImporter $importer): int
    {
        $key = (string) $this->argument('client');
        $client = Client::query()->where('code', $key)->orWhere('id', ctype_digit($key) ? (int) $key : 0)->first();
        if (! $client) {
            $this->error("No existe el cliente «{$key}».");

            return self::FAILURE;
        }

        foreach ($this->argument('files') as $file) {
            if (! is_file($file)) {
                $this->error("No se encuentra el archivo {$file}.");

                return self::FAILURE;
            }
        }

        try {
            $summary = $importer->run($client, $this->argument('files'), (bool) $this->option('dry-run'));
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->info(($summary['dry_run'] ? 'Vista previa' : 'Importado').' para '.$client->name.':');
        $this->table(['Concepto', 'Cantidad'], collect($summary['counts'])->map(fn ($v, $k) => [$k, $v])->values()->all());
        foreach ($summary['warnings'] as $warning) {
            $this->warn('· '.$warning);
        }

        return self::SUCCESS;
    }
}
