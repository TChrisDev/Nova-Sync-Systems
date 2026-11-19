<?php

declare(strict_types=1);

namespace App\Http\Requests\TimeEntries;

use App\Support\BusinessCalendar;
use Carbon\CarbonImmutable;
use Illuminate\Validation\Validator;

/**
 * Reporte de horas: mismo alcance y filtros que el listado, pero siempre
 * sobre un rango de fechas acotado. Sin rango se toman las últimas 8 semanas
 * (de lunes a domingo, terminando en la semana actual).
 */
class TimeEntryReportRequest extends TimeEntryIndexRequest
{
    public const MAX_DAYS = 370;

    public function rules(): array
    {
        return collect(parent::rules())->except(['per_page', 'page'])->all();
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                if ($validator->errors()->isNotEmpty()) {
                    return;
                }

                [$from, $to] = $this->range();
                if ($from->diffInDays($to) + 1 > self::MAX_DAYS) {
                    $validator->errors()->add('from', 'El reporte admite hasta un año de horas. Acorta el rango de fechas.');
                }
            },
        ];
    }

    /** @return array{0: CarbonImmutable, 1: CarbonImmutable} */
    public function range(): array
    {
        $to = $this->filled('to') ? BusinessCalendar::parseDate((string) $this->input('to')) : BusinessCalendar::today()->startOfWeek(CarbonImmutable::MONDAY)->addDays(6);
        $from = $this->filled('from') ? BusinessCalendar::parseDate((string) $this->input('from')) : $to->startOfWeek(CarbonImmutable::MONDAY)->subWeeks(7);

        return [$from, $to];
    }

    /** @return array<string, mixed> */
    public function filters(): array
    {
        [$from, $to] = $this->range();

        return [...parent::filters(), 'from' => $from->toDateString(), 'to' => $to->toDateString()];
    }
}
