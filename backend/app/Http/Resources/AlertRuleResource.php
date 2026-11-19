<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Resources\Concerns\FormatsBusinessData;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\AlertRule */
class AlertRuleResource extends JsonResource
{
    use FormatsBusinessData;

    public function toArray(Request $request): array
    {
        $unit = config("nova.assets.reading_types.{$this->reading_type}.unit", '');

        return [
            'id' => $this->id,
            'client_id' => $this->client_id,
            'scope' => $this->client_id ? 'client' : 'global',
            'name' => $this->name,
            'reading_type' => $this->reading_type,
            'reading_label' => config("nova.assets.reading_types.{$this->reading_type}.label", $this->reading_type),
            'unit' => $unit,
            'operator' => [...$this->enumValue($this->operator), 'symbol' => $this->operator->symbol()],
            'threshold' => $this->threshold,
            'condition' => $this->describe($unit),
            'severity' => $this->enumValue($this->severity),
            'opens_incident' => $this->opens_incident,
            'is_active' => $this->is_active,
            'alerts_count' => $this->whenCounted('alerts'),
            'can' => ['manage' => (bool) $request->user()?->hasPermission('assets.monitor')],
        ];
    }
}
