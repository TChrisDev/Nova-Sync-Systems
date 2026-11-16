<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Evento de dominio pendiente de publicar (o ya publicado) en Kafka.
 * Lo escribe DomainEventRecorder y lo publica el servicio "realtime" en
 * modo relay.
 *
 * @property int $id
 * @property string $event_id
 * @property string $topic
 * @property string $message_key
 * @property string $type
 * @property array $payload
 * @property \Illuminate\Support\Carbon $created_at
 * @property \Illuminate\Support\Carbon|null $published_at
 * @property int $attempts
 * @property string|null $last_error
 */
class OutboxEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'created_at' => 'datetime',
            'published_at' => 'datetime',
        ];
    }
}
