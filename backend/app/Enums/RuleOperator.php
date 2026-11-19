<?php

declare(strict_types=1);

namespace App\Enums;

use App\Enums\Concerns\EnumOptions;

/** Comparación de una regla de alerta contra el valor de la lectura. */
enum RuleOperator: string
{
    use EnumOptions;

    case GreaterThan = 'gt';
    case GreaterOrEqual = 'gte';
    case LessThan = 'lt';
    case LessOrEqual = 'lte';
    case Equal = 'eq';

    public function label(): string
    {
        return match ($this) {
            self::GreaterThan => 'mayor que',
            self::GreaterOrEqual => 'mayor o igual a',
            self::LessThan => 'menor que',
            self::LessOrEqual => 'menor o igual a',
            self::Equal => 'igual a',
        };
    }

    public function symbol(): string
    {
        return match ($this) {
            self::GreaterThan => '>',
            self::GreaterOrEqual => '≥',
            self::LessThan => '<',
            self::LessOrEqual => '≤',
            self::Equal => '=',
        };
    }

    public function matches(float $value, float $threshold): bool
    {
        // Los valores llegan con decimales: se comparan con una tolerancia mínima.
        $epsilon = 0.0001;

        return match ($this) {
            self::GreaterThan => $value > $threshold + $epsilon,
            self::GreaterOrEqual => $value >= $threshold - $epsilon,
            self::LessThan => $value < $threshold - $epsilon,
            self::LessOrEqual => $value <= $threshold + $epsilon,
            self::Equal => abs($value - $threshold) <= $epsilon,
        };
    }
}
