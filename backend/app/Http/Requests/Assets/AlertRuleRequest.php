<?php

declare(strict_types=1);

namespace App\Http\Requests\Assets;

use App\Enums\AlertSeverity;
use App\Enums\RuleOperator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AlertRuleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('assets.monitor');
    }

    public function rules(): array
    {
        $required = $this->isMethod('post') ? 'required' : 'sometimes';

        return [
            'client_id' => [$this->isMethod('post') ? 'nullable' : 'prohibited', 'integer', 'exists:clients,id'],
            'name' => [$required, 'string', 'min:3', 'max:100'],
            'reading_type' => [$required, Rule::in(array_keys(config('nova.assets.reading_types')))],
            'operator' => [$required, Rule::enum(RuleOperator::class)],
            'threshold' => [$required, 'numeric', 'between:-100000,100000'],
            'severity' => [$required, Rule::enum(AlertSeverity::class)],
            'opens_incident' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
