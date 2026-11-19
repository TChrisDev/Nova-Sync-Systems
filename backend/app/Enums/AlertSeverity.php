<?php

declare(strict_types=1);

namespace App\Enums;

use App\Enums\Concerns\EnumOptions;

enum AlertSeverity: string
{
    use EnumOptions;

    case Critical = 'critical';
    case Warning = 'warning';
    case Info = 'info';

    public function label(): string
    {
        return match ($this) {
            self::Critical => 'Crítica',
            self::Warning => 'Aviso',
            self::Info => 'Informativa',
        };
    }

    public function rank(): int
    {
        return match ($this) {
            self::Critical => 3,
            self::Warning => 2,
            self::Info => 1,
        };
    }
}
