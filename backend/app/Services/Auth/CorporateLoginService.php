<?php

namespace App\Services\Auth;

use App\Auth\CorporateIdentity;
use App\Auth\EntraId\AuthenticationFailed;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use Illuminate\Support\Facades\DB;

/**
 * Traduce una identidad corporativa validada (Microsoft 365 o Google
 * Workspace) en un usuario del ERP.
 *
 * La autenticación (quién es) la resuelve el proveedor; aquí solo se decide
 * si esa cuenta está autorizada para ingresar. Los roles y permisos se
 * evalúan después, en cada petición.
 *
 * Una misma persona puede ingresar con los dos proveedores: cada uno guarda
 * su identificador en su propia columna y ambos se encuentran por el correo
 * autorizado la primera vez.
 */
class CorporateLoginService
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function resolveUser(CorporateIdentity $identity): User
    {
        try {
            return DB::transaction(fn () => $this->resolve($identity));
        } catch (AuthenticationFailed $e) {
            $this->audit->log('auth.login_rejected', null, null, [
                'email' => $identity->email(),
                'provider' => $identity->provider(),
                'reason' => $e->reason,
            ]);

            throw $e;
        }
    }

    private function resolve(CorporateIdentity $identity): User
    {
        $column = $identity->subjectColumn();
        $subject = $identity->subject();
        $email = $identity->email();

        $this->assertAllowedDomain($email);

        $user = User::query()->where($column, $subject)->first();

        if (! $user) {
            $user = User::query()->where('email', $email)->first();

            if ($user && $user->{$column} && $user->{$column} !== $subject) {
                // El correo ya está vinculado a otra identidad de este proveedor.
                throw new AuthenticationFailed(AuthenticationFailed::ACCOUNT_MISMATCH, "Identificador de {$identity->provider()} distinto para el mismo correo.");
            }
        }

        // Una cuenta eliminada no vuelve a entrar por su cuenta, ni siquiera
        // con el registro automático activo: un administrador debe autorizarla.
        if (! $user && User::onlyTrashed()
            ->where(fn ($q) => $q->where($column, $subject)->orWhere('email', $email))
            ->exists()) {
            throw new AuthenticationFailed(AuthenticationFailed::NOT_AUTHORIZED, 'La cuenta fue eliminada.');
        }

        if (! $user) {
            if (! config('nova.auth.auto_provision_users')) {
                throw new AuthenticationFailed(AuthenticationFailed::NOT_AUTHORIZED, 'Cuenta no autorizada previamente.');
            }

            $user = new User(['email' => $email, 'name' => $identity->name()]);
            $user->forceFill(['is_active' => true]);
            $this->audit->log('user.auto_provisioned', null, null, ['email' => $email, 'provider' => $identity->provider()]);
        }

        if ($user->exists && ! $user->is_active) {
            throw new AuthenticationFailed(AuthenticationFailed::ACCOUNT_INACTIVE, 'Cuenta desactivada.');
        }

        $emailTaken = User::query()
            ->where('email', $email)
            ->when($user->exists, fn ($q) => $q->whereKeyNot($user->getKey()))
            ->exists();

        $user->forceFill([
            'name' => $identity->name(),
            'email' => $emailTaken ? $user->email : $email,
            ...$identity->linkAttributes(),
            'last_login_at' => now(),
        ])->save();

        $this->audit->log('auth.login', $user, $user, ['provider' => $identity->provider()]);

        return $user;
    }

    private function assertAllowedDomain(string $email): void
    {
        $allowed = config('nova.auth.allowed_email_domains', []);
        $domain = mb_strtolower((string) substr(strrchr($email, '@') ?: '', 1));

        if ($allowed && ! in_array($domain, $allowed, true)) {
            throw new AuthenticationFailed(AuthenticationFailed::NOT_AUTHORIZED, "Dominio {$domain} no permitido.");
        }
    }
}
