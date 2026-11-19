<?php

declare(strict_types=1);

namespace App\Enums;

use App\Enums\Concerns\EnumOptions;

/** Tipo de equipo. Define en qué grupo cuenta y si se le mide el monitoreo de red. */
enum AssetCategory: string
{
    use EnumOptions;

    case Router = 'router';
    case Firewall = 'firewall';
    case CoreSwitch = 'switch_l3';
    case AccessSwitch = 'switch_access';
    case Server = 'server';
    case Desktop = 'pc';
    case Laptop = 'laptop';
    case Camera = 'cctv';
    case Sensor = 'iot';
    case Controller = 'mcu';
    case Power = 'power';
    case Other = 'other';

    public function label(): string
    {
        return match ($this) {
            self::Router => 'Router',
            self::Firewall => 'Firewall',
            self::CoreSwitch => 'Switch capa 3',
            self::AccessSwitch => 'Switch de acceso',
            self::Server => 'Servidor',
            self::Desktop => 'PC de escritorio',
            self::Laptop => 'Portátil',
            self::Camera => 'Cámara / CCTV',
            self::Sensor => 'Sensor IoT',
            self::Controller => 'Controlador IoT',
            self::Power => 'Energía',
            self::Other => 'Otro',
        };
    }

    /** network · user · iot · other */
    public function group(): string
    {
        return match ($this) {
            self::Router, self::Firewall, self::CoreSwitch, self::AccessSwitch => 'network',
            self::Desktop, self::Laptop => 'user',
            self::Camera, self::Sensor, self::Controller => 'iot',
            default => 'other',
        };
    }

    /** Equipos de red: los que deberían enviar Syslog, SNMP, NTP... */
    public function isNetwork(): bool
    {
        return $this->group() === 'network';
    }

    /** Capa en el mapa de red (de Internet hacia adentro). */
    public function layer(): ?int
    {
        return match ($this) {
            self::Router => 0,
            self::Firewall => 1,
            self::CoreSwitch => 2,
            self::AccessSwitch => 3,
            default => null,
        };
    }

    public static function groupLabels(): array
    {
        return ['network' => 'Equipos de red', 'user' => 'Equipos de usuario', 'iot' => 'CCTV e IoT', 'other' => 'Otros'];
    }
}
