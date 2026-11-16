<?php

namespace App\Observers;

use App\Services\Events\DomainEventRecorder;
use Illuminate\Database\Eloquent\Model;

/**
 * Convierte los cambios de los modelos de negocio en eventos de dominio.
 * Corre dentro de la transacción del servicio que hace el cambio, de modo
 * que el evento y el cambio se confirman (o se revierten) juntos.
 */
class DomainEventObserver
{
    public function __construct(private readonly DomainEventRecorder $events) {}

    public function created(Model $model): void
    {
        $this->events->recordModel($model, 'created');
    }

    public function updated(Model $model): void
    {
        $this->events->recordModel($model, 'updated');
    }

    public function deleted(Model $model): void
    {
        $this->events->recordModel($model, 'deleted');
    }

    public function restored(Model $model): void
    {
        $this->events->recordModel($model, 'restored');
    }
}
