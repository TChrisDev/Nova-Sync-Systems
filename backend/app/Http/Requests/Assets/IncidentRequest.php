<?php

declare(strict_types=1);

namespace App\Http\Requests\Assets;

use App\Enums\AlertSeverity;
use App\Enums\IncidentStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class IncidentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('assets.incidents');
    }

    public function rules(): array
    {
        $creating = $this->isMethod('post');

        return [
            'client_id' => [$creating ? 'required' : 'prohibited', 'integer', 'exists:clients,id'],
            'title' => [$creating ? 'required' : 'sometimes', 'string', 'min:5', 'max:150'],
            'severity' => [$creating ? 'required' : 'sometimes', Rule::enum(AlertSeverity::class)],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'resolution' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'status' => [$creating ? 'prohibited' : 'sometimes', Rule::enum(IncidentStatus::class)],
            'project_id' => ['sometimes', 'nullable', 'integer', 'exists:projects,id'],
            'assigned_to' => ['sometimes', 'nullable', 'integer', Rule::exists('users', 'id')->where('is_active', true)->whereNull('deleted_at')],
        ];
    }
}
