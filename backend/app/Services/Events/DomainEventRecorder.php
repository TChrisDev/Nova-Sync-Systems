<?php

namespace App\Services\Events;

use App\Models\Allocation;
use App\Models\Client;
use App\Models\ClientContact;
use App\Models\Contract;
use App\Models\ContractHourMovement;
use App\Models\OutboxEvent;
use App\Models\Project;
use App\Models\Role;
use App\Models\StaffProfile;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

/**
 * Registra eventos de dominio en la bandeja de salida (outbox_events) para
 * que el relay los publique en Kafka.
 *
 * Los eventos son avisos de cambio, no copias de los datos: llevan el tipo,
 * el identificador, los nombres de los campos que cambiaron (nunca sus
 * valores), referencias a los registros relacionados y las personas
 * involucradas. Quien necesite el dato lo pide a la API, que vuelve a
 * aplicar los permisos. Así ningún consumidor ve costos ni datos personales
 * a los que no tiene acceso.
 */
class DomainEventRecorder
{
    public const SCHEMA_VERSION = 1;

    /**
     * Modelos que publican eventos: nombre estable del agregado y módulo
     * del ERP al que pertenecen (define el tópico nova.<módulo>).
     *
     * @var array<class-string<Model>, array{0: string, 1: string}>
     */
    public const MODELS = [
        Client::class => ['client', 'clients'],
        ClientContact::class => ['client_contact', 'clients'],
        Contract::class => ['contract', 'clients'],
        ContractHourMovement::class => ['contract_hour_movement', 'clients'],
        Project::class => ['project', 'projects'],
        Allocation::class => ['allocation', 'projects'],
        StaffProfile::class => ['staff_profile', 'projects'],
        TimeEntry::class => ['time_entry', 'timesheets'],
        User::class => ['user', 'users'],
        Role::class => ['role', 'access_control'],
    ];

    /** Cambios que no merecen un evento por sí solos. */
    private const IGNORED_CHANGES = ['updated_at', 'last_login_at'];

    /** Campos cuyo nombre tampoco se publica (costos internos). */
    private const SENSITIVE_FIELDS = ['hourly_cost', 'cost_rate'];

    public static function enabled(): bool
    {
        return (bool) config('nova.events.enabled');
    }

    /** Evento a partir de un cambio de un modelo (lo llama el observer). */
    public function recordModel(Model $model, string $action): ?OutboxEvent
    {
        if (! self::enabled() || ! isset(self::MODELS[$model::class])) {
            return null;
        }

        $changed = [];
        if ($action === 'updated') {
            $changed = array_values(array_diff(array_keys($model->getChanges()), self::IGNORED_CHANGES));
            if ($changed === []) {
                return null;
            }
        }

        [$aggregate, $module] = self::MODELS[$model::class];

        return $this->record(
            type: "{$aggregate}.{$action}",
            module: $module,
            aggregateType: $aggregate,
            aggregateId: $model->getKey(),
            changed: array_values(array_diff($changed, self::SENSITIVE_FIELDS)),
            refs: $this->refs($model),
            userIds: $this->involvedUsers($model),
        );
    }

    /** Evento explícito (p. ej. cambios en tablas pivote, que Eloquent no observa). */
    public function record(
        string $type,
        string $module,
        string $aggregateType,
        int|string $aggregateId,
        array $changed = [],
        array $refs = [],
        array $userIds = [],
    ): ?OutboxEvent {
        if (! self::enabled()) {
            return null;
        }

        $eventId = (string) Str::uuid7();
        $topic = config('nova.events.topic_prefix', 'nova').'.'.$module;

        $event = new OutboxEvent;
        $event->forceFill([
            'event_id' => $eventId,
            'topic' => $topic,
            'message_key' => "{$aggregateType}:{$aggregateId}",
            'type' => $type,
            'payload' => [
                'schema_version' => self::SCHEMA_VERSION,
                'event_id' => $eventId,
                'type' => $type,
                'module' => $module,
                'aggregate' => ['type' => $aggregateType, 'id' => $aggregateId],
                'changed' => $changed,
                'refs' => (object) array_filter($refs, fn ($v) => $v !== null),
                'audience' => ['user_ids' => array_values(array_unique(array_filter(array_map('intval', $userIds))))],
                'actor_id' => Auth::id(),
                'occurred_at' => now()->toIso8601ZuluString('microsecond'),
            ],
            'created_at' => now(),
        ])->save();

        return $event;
    }

    /** Identificadores de los registros padre, para refrescar vistas relacionadas. */
    private function refs(Model $model): array
    {
        return match (true) {
            $model instanceof ClientContact, $model instanceof Contract => ['client_id' => $model->client_id],
            $model instanceof ContractHourMovement => ['contract_id' => $model->contract_id],
            $model instanceof Project => ['contract_id' => $model->contract_id],
            $model instanceof Allocation, $model instanceof TimeEntry => ['project_id' => $model->project_id, 'user_id' => $model->user_id],
            $model instanceof StaffProfile => ['user_id' => $model->user_id],
            default => [],
        };
    }

    /**
     * Personas a las que el cambio les concierne aunque no tengan permiso de
     * ver todo el módulo: el dueño del registro y el líder del proyecto.
     *
     * @return list<int|null>
     */
    private function involvedUsers(Model $model): array
    {
        return match (true) {
            $model instanceof Project => [$model->leader_id, $model->getOriginal('leader_id')],
            $model instanceof Allocation, $model instanceof TimeEntry => [$model->user_id, $this->leaderOf($model->project_id)],
            $model instanceof StaffProfile => [$model->user_id],
            $model instanceof User => [$model->getKey()],
            default => [],
        };
    }

    private function leaderOf(?int $projectId): ?int
    {
        return $projectId ? Project::query()->whereKey($projectId)->value('leader_id') : null;
    }
}
