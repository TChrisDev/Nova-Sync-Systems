<?php

declare(strict_types=1);

namespace App\Enums;

use App\Enums\Concerns\EnumOptions;

enum Criticality: string
{
    use EnumOptions;

    case Critical = 'critical';
    case High = 'high';
    case Medium = 'medium';
    case Low = 'low';

    public function label(): string
    {
        return match ($this) {
            self::Critical => 'Crítica',
            self::High => 'Alta',
            self::Medium => 'Media',
            self::Low => 'Baja',
        };
    }
}
