<?php

namespace App\Http\Controllers\Auth;

use App\Auth\CorporateIdentity;
use App\Auth\EntraId\AuthenticationFailed;
use App\Http\Controllers\Controller;
use App\Services\Auth\CorporateLoginService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Laravel\Socialite\Two\InvalidStateException;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirect;
use Throwable;

/**
 * Flujo común OAuth 2.0 / OpenID Connect para los proveedores corporativos.
 * El navegador nunca envía credenciales a esta aplicación: la persona se
 * autentica en la página oficial del proveedor y vuelve con un código de un
 * solo uso que el backend canjea y valida.
 */
abstract class OidcAuthController extends Controller
{
    /** Nombre del proveedor para los registros ("Microsoft", "Google"). */
    abstract protected function providerLabel(): string;

    abstract protected function isConfigured(): bool;

    /** @return list<string> */
    abstract protected function configurationProblems(): array;

    abstract protected function startRedirect(): SymfonyRedirect;

    abstract protected function validatedIdentity(): CorporateIdentity;

    public function redirect(): SymfonyRedirect
    {
        if (! $this->isConfigured()) {
            Log::warning("Inicio de sesión con {$this->providerLabel()} no configurado.", ['problems' => $this->configurationProblems()]);

            return $this->toFrontend('/login', ['error' => AuthenticationFailed::NOT_CONFIGURED]);
        }

        return $this->startRedirect();
    }

    public function callback(Request $request, CorporateLoginService $login): RedirectResponse
    {
        if (! $this->isConfigured()) {
            return $this->toFrontend('/login', ['error' => AuthenticationFailed::NOT_CONFIGURED]);
        }

        if ($request->filled('error')) {
            Log::notice("{$this->providerLabel()} devolvió un error en el inicio de sesión.", [
                'error' => $request->string('error')->limit(100)->toString(),
            ]);

            $reason = $request->input('error') === 'access_denied' ? 'access_denied' : AuthenticationFailed::PROVIDER_ERROR;

            return $this->toFrontend('/login', ['error' => $reason]);
        }

        try {
            $user = $login->resolveUser($this->validatedIdentity());
        } catch (InvalidStateException) {
            return $this->toFrontend('/login', ['error' => AuthenticationFailed::INVALID_STATE]);
        } catch (AuthenticationFailed $e) {
            Log::notice('Inicio de sesión rechazado.', ['provider' => $this->providerLabel(), 'reason' => $e->reason, 'detail' => $e->getMessage()]);

            return $this->toFrontend('/login', ['error' => $e->reason]);
        } catch (Throwable $e) {
            report($e);

            return $this->toFrontend('/login', ['error' => AuthenticationFailed::PROVIDER_ERROR]);
        }

        Auth::guard('web')->login($user);
        $request->session()->regenerate();

        return $this->toFrontend('/app');
    }

    protected function toFrontend(string $path, array $query = []): RedirectResponse
    {
        $url = config('nova.frontend_url').$path;

        return redirect()->away($query ? $url.'?'.http_build_query($query) : $url);
    }
}
