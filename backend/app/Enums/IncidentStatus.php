<?php

declare(strict_types=1);

namespace App\Enums;

use App\Enums\Concerns\EnumOptions;

enum IncidentStatus: string
{
    use EnumOptions;

    case Open = 'open';
    case InProgress = 'in_progress';
    case Resolved = 'resolved';
    case FalsePositive = 'false_positive';

    public function label(): string
    {
        return match ($this) {
            self::Open => 'Abierto',
            self::InProgress => 'En atención',
            self::Resolved => 'Resuelto',
            self::FalsePositive => 'Falso positivo',
        };
    }

    public function isClosed(): bool
    {
        return $this === self::Resolved || $this === self::FalsePositive;
    }
}
