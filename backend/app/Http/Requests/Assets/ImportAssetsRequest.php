<?php

declare(strict_types=1);

namespace App\Http\Requests\Assets;

use Illuminate\Foundation\Http\FormRequest;

class ImportAssetsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('assets.import');
    }

    public function rules(): array
    {
        $max = (int) config('nova.assets.max_import_kb', 10240);

        return [
            'client_id' => ['required', 'integer', 'exists:clients,id'],
            'files' => ['required', 'array', 'min:1', 'max:4'],
            'files.*' => ['file', "max:{$max}", 'extensions:xlsx', 'mimetypes:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,application/octet-stream'],
            'dry_run' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'files.required' => 'Adjunta al menos un archivo de Excel (.xlsx).',
            'files.*.extensions' => 'Solo se aceptan archivos de Excel (.xlsx).',
            'files.*.max' => 'Cada archivo puede pesar hasta :max KB.',
        ];
    }
}
