<?php

declare(strict_types=1);

namespace App\Http\Requests\Assets;

use App\Enums\AssetCategory;
use App\Enums\Criticality;
use App\Models\Asset;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Crear o editar un equipo. Las IP se validan como IPv4 o IPv6. */
class AssetRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission($this->isMethod('post') ? 'assets.create' : 'assets.update');
    }

    public function rules(): array
    {
        $required = $this->isMethod('post') ? 'required' : 'sometimes';
        $technical = $this->user()->hasPermission('assets.technical');

        return [
            'client_id' => [$this->isMethod('post') ? 'required' : 'prohibited', 'integer', 'exists:clients,id'],
            'name' => [$required, 'string', 'min:2', 'max:120'],
            'category' => [$required, Rule::enum(AssetCategory::class)],
            'criticality' => [$required, Rule::enum(Criticality::class)],
            'model' => ['sometimes', 'nullable', 'string', 'max:80'],
            'role' => ['sometimes', 'nullable', 'string', 'max:80'],
            'location' => ['sometimes', 'nullable', 'string', 'max:120'],
            'vlan' => ['sometimes', 'nullable', 'string', 'max:40'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'is_active' => ['sometimes', 'boolean'],
            'monitoring' => ['sometimes', 'nullable', 'array'],
            ...collect(Asset::MONITORING_CONTROLS)->mapWithKeys(fn ($c) => ["monitoring.{$c}" => ['sometimes', 'boolean']])->all(),
            'reading_type' => ['sometimes', 'nullable', Rule::in(array_keys(config('nova.assets.reading_types')))],
            'reading_unit' => ['sometimes', 'nullable', 'string', 'max:10'],
            // Datos técnicos: solo quien puede verlos puede escribirlos.
            'serial' => [$technical ? 'sometimes' : 'prohibited', 'nullable', 'string', 'max:80'],
            'ip_addresses' => [$technical ? 'sometimes' : 'prohibited', 'nullable', 'array', 'max:64'],
            'ip_addresses.*' => ['ip'],
            'mac_addresses' => [$technical ? 'sometimes' : 'prohibited', 'nullable', 'array', 'max:64'],
            'mac_addresses.*' => ['string', 'regex:/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$|^([0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}$/'],
            'gateway' => [$technical ? 'sometimes' : 'prohibited', 'nullable', 'ip'],
            'iot_server' => [$technical ? 'sometimes' : 'prohibited', 'nullable', 'ip'],
        ];
    }

    public function messages(): array
    {
        return [
            'ip_addresses.*.ip' => 'Cada dirección IP debe ser IPv4 o IPv6 válida.',
            'mac_addresses.*.regex' => 'Cada MAC debe tener el formato 00:1A:2B:3C:4D:5E o 001A.2B3C.4D5E.',
            'gateway.ip' => 'El gateway debe ser una dirección IP válida.',
            '*.prohibited' => 'No tienes permiso para registrar datos técnicos (IP, MAC, serial).',
        ];
    }
}
