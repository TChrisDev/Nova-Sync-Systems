<?php

declare(strict_types=1);

namespace App\Services\Timesheets;

use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Services\Contracts\ContractsExport;
use App\Support\BusinessCalendar;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Exportación del registro de horas para Excel, con las mismas reglas que la
 * de contratos: punto y coma, BOM UTF-8, celdas neutralizadas contra
 * fórmulas y costos solo para quien tiene projects.financials.
 */
class TimeEntriesExport
{
    public const MAX_ROWS = 20000;

    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * @param  array<string, mixed>  $filters
     */
    public function stream(User $actor, Builder $query, string $scope, array $filters): StreamedResponse
    {
        $financials = $actor->hasPermission('projects.financials');
        $total = min((clone $query)->count(), self::MAX_ROWS);

        $this->audit->log('time_entries.exported', $actor, null, [
            'rows' => $total,
            'scope' => $scope,
            'filters' => $filters,
            'with_financials' => $financials,
        ]);

        $filename = 'registro-de-horas-'.BusinessCalendar::today()->format('Y-m-d').'.csv';
        $query = $query->with(['user:id,name', 'project:id,code,name', 'reviewer:id,name'])->orderBy('work_date')->orderBy('id');

        return new StreamedResponse(function () use ($query, $financials) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");
            $this->write($out, $this->header($financials));

            $written = 0;
            $query->limit(self::MAX_ROWS)->chunk(500, function (Collection $entries) use ($out, $financials, &$written) {
                foreach ($entries as $entry) {
                    if ($written++ >= self::MAX_ROWS) {
                        return false;
                    }
                    $this->write($out, $this->row($entry, $financials));
                }
            });

            fclose($out);
        }, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
            'Cache-Control' => 'no-store, private',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** @return list<string> */
    private function header(bool $financials): array
    {
        $columns = [
            'Fecha', 'Persona', 'Código del proyecto', 'Proyecto', 'Horas', 'Estado', 'Facturable',
            'Fuera de horario', 'Disponibilidad 24/7', 'Descripción', 'Revisado por', 'Motivo del rechazo',
        ];

        return $financials ? [...$columns, 'Costo interno (COP)'] : $columns;
    }

    /** @return list<string|int|null> */
    private function row(TimeEntry $entry, bool $financials): array
    {
        $row = [
            $entry->work_date?->toDateString(),
            $entry->user?->name,
            $entry->project?->code,
            $entry->project?->name,
            number_format($entry->minutes / 60, 2, ',', ''),
            $entry->status->label(),
            $entry->is_billable ? 'Sí' : 'No',
            $entry->is_after_hours ? 'Sí' : 'No',
            $entry->is_on_call ? 'Sí' : 'No',
            $entry->description,
            $entry->reviewer?->name,
            $entry->rejection_reason,
        ];

        if ($financials) {
            $row[] = $entry->cost_rate !== null ? intdiv($entry->minutes * $entry->cost_rate, 60) : null;
        }

        return $row;
    }

    /** @param  list<string|int|null>  $values */
    private function write($handle, array $values): void
    {
        fputcsv($handle, array_map([ContractsExport::class, 'safeCell'], $values), ';', '"', '');
    }
}
