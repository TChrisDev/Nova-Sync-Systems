<?php

namespace App\Http\Controllers\Auth;

use App\Auth\CorporateIdentity;
use App\Auth\Google\GoogleConfig;
use Laravel\Socialite\Facades\Socialite;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirect;

/**
 * Inicio de sesión con Google Workspace. El usuario se autentica en
 * accounts.google.com y solo se aceptan los dominios de Workspace
 * configurados en GOOGLE_WORKSPACE_DOMAINS.
 */
class GoogleAuthController extends OidcAuthController
{
    public function __construct(private readonly GoogleConfig $config) {}

    protected function providerLabel(): string
    {
        return 'Google';
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
        return Socialite::driver('google-workspace')->redirect();
    }

    protected function validatedIdentity(): CorporateIdentity
    {
        return Socialite::driver('google-workspace')->identity();
    }
}
