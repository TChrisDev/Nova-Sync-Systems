<?php

namespace App\Console\Commands;

use App\Models\OutboxEvent;
use Illuminate\Console\Command;

/**
 * Borra de la bandeja de salida los eventos que ya se publicaron en Kafka.
 * Los pendientes nunca se borran: esperan al relay. Kafka conserva su propia
 * copia según la retención de cada tópico.
 */
class PruneOutbox extends Command
{
    protected $signature = 'nova:outbox-prune {--days= : Días que se conservan los eventos publicados}';

    protected $description = 'Elimina los eventos ya publicados en Kafka de la bandeja de salida.';

    public function handle(): int
    {
        $days = (int) ($this->option('days') ?? config('nova.events.retention_days', 7));
        $cutoff = now()->subDays(max(1, $days));

        $deleted = 0;
        do {
            $ids = OutboxEvent::query()
                ->whereNotNull('published_at')
                ->where('published_at', '<', $cutoff)
                ->orderBy('id')
                ->limit(1000)
                ->pluck('id');

            $deleted += $ids->isEmpty() ? 0 : OutboxEvent::query()->whereKey($ids)->delete();
        } while ($ids->isNotEmpty());

        $pending = OutboxEvent::query()->whereNull('published_at')->count();

        $this->info("Eventos publicados eliminados: {$deleted}. Pendientes de publicar: {$pending}.");

        return self::SUCCESS;
    }
}
