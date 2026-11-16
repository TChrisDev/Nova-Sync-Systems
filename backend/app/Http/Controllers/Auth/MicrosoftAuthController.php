<?php

namespace App\Http\Controllers\Auth;

use App\Auth\CorporateIdentity;
use App\Auth\EntraId\EntraIdConfig;
use Laravel\Socialite\Facades\Socialite;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirect;

/**
 * Inicio de sesión con Microsoft 365 (Microsoft Entra ID, tenant único).
 * El usuario se autentica en login.microsoftonline.com.
 */
class MicrosoftAuthController extends OidcAuthController
{
    public function __construct(private readonly EntraIdConfig $config) {}

    protected function providerLabel(): string
    {
        return 'Microsoft';
    }

    protected function isConfigured(): bool
    {
        return $this->config->isConfigured();
    }

    protected function configurationProblems(): array
    {
        return $this->config->problems();
    }

    protected function startRedirect(): SymfonyRedirect
    {
        return Socialite::driver('entra')->redirect();
    }

    protected function validatedIdentity(): CorporateIdentity
    {
        return Socialite::driver('entra')->identity();
    }
}
