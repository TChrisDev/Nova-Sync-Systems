<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Bandeja de salida (patrón "transactional outbox") de los eventos de
 * dominio que se publican en Kafka.
 *
 * El evento se escribe en la misma transacción que el cambio: si la
 * transacción se revierte, el evento desaparece con ella, y si Kafka no está
 * disponible, el evento espera aquí hasta que el relay lo publique. Así no se
 * pierden ni se inventan cambios.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('outbox_events', function (Blueprint $table) {
            $table->id();
            $table->uuid('event_id')->unique();          // identificador para deduplicar en los consumidores
            $table->string('topic', 120);                // nova.projects, nova.clients...
            $table->string('message_key', 120);          // tipo:id del agregado (orden por partición)
            $table->string('type', 120);                 // project.updated, time_entry.created...
            $table->json('payload');
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('published_at')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->string('last_error', 500)->nullable();

            // El relay busca siempre los pendientes en orden de llegada.
            $table->index(['published_at', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('outbox_events');
    }
};
