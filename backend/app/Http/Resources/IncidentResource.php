<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Resources\Concerns\FormatsBusinessData;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\Incident */
class IncidentResource extends JsonResource
{
    use FormatsBusinessData;

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'title' => $this->title,
            'severity' => $this->enumValue($this->severity),
            'status' => $this->enumValue($this->status),
            'is_closed' => $this->status->isClosed(),
            'opened_at' => $this->opened_at?->toIso8601String(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),
            'description' => $this->description,
            'resolution' => $this->resolution,
            'client' => $this->whenLoaded('client', fn () => ['id' => $this->client->id, 'name' => $this->client->name]),
            'project' => $this->whenLoaded('project', fn () => $this->project ? ['id' => $this->project->id, 'code' => $this->project->code, 'name' => $this->project->name] : null),
            'assignee' => $this->whenLoaded('assignee', fn () => $this->assignee ? ['id' => $this->assignee->id, 'name' => $this->assignee->name] : null),
            'alerts_count' => $this->whenCounted('alerts'),
            'minutes' => $this->when(isset($this->time_entries_sum_minutes) || $this->relationLoaded('timeEntries'), fn () => (int) ($this->time_entries_sum_minutes ?? $this->timeEntries->sum('minutes'))),
            'can' => ['manage' => (bool) $request->user()?->hasPermission('assets.incidents')],
        ];
    }
}
