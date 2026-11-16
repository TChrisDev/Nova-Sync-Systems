<?php

namespace App\Services\Realtime;

use App\Models\User;

/**
 * Emite el "ticket" con el que el navegador abre la conexión en tiempo real
 * (Server-Sent Events) con el servicio realtime.
 *
 * El ticket es corto (60 s para conectarse), va firmado con HMAC-SHA256 y
 * una clave que solo conocen Laravel y el servicio realtime, y dice qué
 * módulos puede seguir completos esa persona. La conexión se cierra sola al
 * cumplir su vida máxima (15 min): el navegador pide otro ticket, y en ese
 * momento Laravel vuelve a revisar la sesión, la cuenta y los permisos.
 */
class RealtimeTicketIssuer
{
    public const VERSION = 'v1';

    /**
     * Permisos que dan acceso a todos los eventos de un módulo. Sin ellos,
     * la persona solo recibe los eventos en los que aparece (sus horas, los
     * proyectos que lidera, su perfil...).
     */
    public const MODULE_SCOPES = [
        'clients' => ['clients.view'],
        'projects' => ['projects.view'],
        'timesheets' => ['timesheets.view', 'timesheets.approve_any'],
        'users' => ['users.view'],
        'access_control' => ['access_control.view'],
    ];

    public function isAvailable(): bool
    {
        return (bool) config('nova.events.enabled') && strlen((string) config('nova.realtime.secret')) >= 32;
    }

    /** @return array{ticket: string, expires_at: string, stream_url: string} */
    public function issue(User $user): array
    {
        $now = time();
        $ttl = (int) config('nova.realtime.ticket_ttl', 60);

        $claims = [
            'uid' => $user->getKey(),
            'scopes' => $this->scopes($user),
            'iat' => $now,
            'exp' => $now + $ttl,
            'sx' => $now + (int) config('nova.realtime.stream_max_seconds', 900),
        ];

        $body = self::VERSION.'.'.self::base64url(json_encode($claims, JSON_THROW_ON_ERROR));
        $signature = self::base64url(hash_hmac('sha256', $body, (string) config('nova.realtime.secret'), true));

        return [
            'ticket' => $body.'.'.$signature,
            'expires_at' => date(DATE_ATOM, $claims['exp']),
            'stream_url' => (string) config('nova.realtime.stream_path', '/realtime/stream'),
        ];
    }

    /** @return list<string> */
    public function scopes(User $user): array
    {
        $scopes = [];

        foreach (self::MODULE_SCOPES as $module => $permissions) {
            foreach ($permissions as $permission) {
                if ($user->hasPermission($permission)) {
                    $scopes[] = $module;
                    break;
                }
            }
        }

        return $scopes;
    }

    private static function base64url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
