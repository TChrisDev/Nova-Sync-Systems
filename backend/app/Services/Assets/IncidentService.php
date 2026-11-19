<?php

declare(strict_types=1);

namespace App\Services\Assets;

use App\Enums\IncidentStatus;
use App\Exceptions\BusinessRuleException;
use App\Models\Client;
use App\Models\Incident;
use App\Models\Project;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Support\CodeGenerator;
use Illuminate\Support\Facades\DB;

/**
 * Ciclo de un incidente: abierto → en atención → resuelto o falso positivo.
 * Cerrar exige explicar cómo se resolvió; reabrir es posible si vuelve a
 * pasar. El proyecto debe ser de un contrato del mismo cliente, porque ahí
 * se registran las horas de la atención.
 */
class IncidentService
{
    public function __construct(
        private readonly CodeGenerator $codes,
        private readonly AuditLogger $audit,
        private readonly AlertEngine $engine,
    ) {}

    /** @param  array<string, mixed>  $data */
    public function open(User $actor, Client $client, array $data): Incident
    {
        return DB::transaction(function () use ($actor, $client, $data) {
            $projectId = $data['project_id'] ?? $this->engine->supportProject($client)?->getKey();
            if ($projectId) {
                $this->assertProjectOfClient((int) $projectId, $client);
            }

            $incident = new Incident(['title' => $data['title'], 'severity' => $data['severity'], 'description' => $data['description'] ?? null]);
            $incident->forceFill([
                'client_id' => $client->getKey(),
                'project_id' => $projectId,
                'code' => $this->codes->nextIncidentCode((int) now(config('nova.timezone'))->format('Y')),
                'status' => IncidentStatus::Open,
                'opened_at' => now(),
                'assigned_to' => $data['assigned_to'] ?? null,
                'created_by' => $actor->getKey(),
            ])->save();

            $this->audit->log('incident.opened', $actor, $incident, ['code' => $incident->code, 'automatic' => false]);

            return $incident;
        });
    }

    /** @param  array<string, mixed>  $data */
    public function update(User $actor, Incident $incident, array $data): Incident
    {
        return DB::transaction(function () use ($actor, $incident, $data) {
            $before = $incident->status;

            if (array_key_exists('project_id', $data) && $data['project_id']) {
                $this->assertProjectOfClient((int) $data['project_id'], $incident->client);
            }

            $incident->fill(array_intersect_key($data, array_flip(['title', 'severity', 'description', 'resolution'])));
            foreach (['project_id', 'assigned_to'] as $key) {
                if (array_key_exists($key, $data)) {
                    $incident->forceFill([$key => $data[$key]]);
                }
            }

            if (isset($data['status'])) {
                $status = IncidentStatus::from($data['status']);
                if ($status->isClosed() && ! trim((string) ($incident->resolution ?? ''))) {
                    throw new BusinessRuleException('Para cerrar el incidente explica cómo se resolvió (o por qué fue un falso positivo).', 'resolution_required', 422);
                }
                $incident->forceFill([
                    'status' => $status,
                    'resolved_at' => $status->isClosed() ? ($incident->resolved_at ?? now()) : null,
                ]);
                if ($status === IncidentStatus::InProgress && ! $incident->assigned_to) {
                    $incident->forceFill(['assigned_to' => $actor->getKey()]);
                }
            }

            $changes = array_keys($incident->getDirty());
            $incident->save();

            $this->audit->log($before !== $incident->status ? 'incident.status_changed' : 'incident.updated', $actor, $incident, [
                'code' => $incident->code,
                'from' => $before->value,
                'to' => $incident->status->value,
                'fields' => $changes,
            ]);

            return $incident;
        });
    }

    private function assertProjectOfClient(int $projectId, Client $client): void
    {
        $project = Project::query()->with('contract:id,client_id')->find($projectId);
        if (! $project || $project->contract->client_id !== $client->getKey()) {
            throw new BusinessRuleException('El proyecto debe ser de un contrato de este cliente.', 'project_other_client', 422);
        }
    }
}
