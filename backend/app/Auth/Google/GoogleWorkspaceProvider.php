<?php

namespace App\Auth\Google;

use App\Auth\EntraId\AuthenticationFailed;
use GuzzleHttp\Exception\GuzzleException;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;
use Laravel\Socialite\Two\AbstractProvider;
use Laravel\Socialite\Two\InvalidStateException;
use Laravel\Socialite\Two\User as SocialiteUser;

/**
 * Proveedor OpenID Connect para Google Workspace.
 *
 * Mismo modelo que el de Microsoft: Authorization Code + PKCE con cliente
 * confidencial, "state" y "nonce", y la identidad sale del id_token validado
 * en el servidor. No se piden permisos sobre Gmail, Drive ni el directorio.
 */
class GoogleWorkspaceProvider extends AbstractProvider
{
    protected $scopes = ['openid', 'profile', 'email'];

    protected $scopeSeparator = ' ';

    protected $usesPKCE = true;

    private ?GoogleConfig $googleConfig = null;

    private ?GoogleIdTokenValidator $validator = null;

    private ?GoogleIdentity $identity = null;

    public function withGoogleConfig(GoogleConfig $config, GoogleIdTokenValidator $validator): static
    {
        $this->googleConfig = $config;
        $this->validator = $validator;

        return $this;
    }

    protected function getAuthUrl($state): string
    {
        return $this->buildAuthUrlFromBase(GoogleConfig::AUTHORIZE_URL, $state);
    }

    protected function getCodeFields($state = null): array
    {
        $nonce = Str::random(40);
        $this->request->session()->put('google_nonce', $nonce);

        $fields = array_merge(parent::getCodeFields($state), [
            'nonce' => $nonce,
            'prompt' => 'select_account',
        ]);

        // "hd" solo filtra la pantalla de Google; la regla real se aplica al
        // validar el id_token.
        if (count($this->googleConfig->workspaceDomains) === 1) {
            $fields['hd'] = $this->googleConfig->workspaceDomains[0];
        }

        return $fields;
    }

    protected function getTokenUrl(): string
    {
        return GoogleConfig::TOKEN_URL;
    }

    public function user(): SocialiteUser
    {
        if ($this->user) {
            return $this->user;
        }

        if ($this->hasInvalidState()) {
            throw new InvalidStateException;
        }

        $nonce = $this->request->session()->pull('google_nonce');

        try {
            $response = $this->getAccessTokenResponse($this->getCode());
        } catch (GuzzleException $e) {
            throw new AuthenticationFailed(AuthenticationFailed::PROVIDER_ERROR, 'Error al canjear el código de autorización de Google: '.$e->getMessage());
        }

        $idToken = Arr::get($response, 'id_token');

        if (! is_string($idToken) || $idToken === '') {
            throw new AuthenticationFailed(AuthenticationFailed::INVALID_TOKEN, 'La respuesta de Google no incluye id_token.');
        }

        $identity = $this->identity = $this->validator->validate($idToken, $nonce);

        $this->user = (new SocialiteUser)
            ->setRaw(['sub' => $identity->subject, 'hd' => $identity->hostedDomain])
            ->map([
                'id' => $identity->subject,
                'name' => $identity->name,
                'email' => $identity->email,
            ]);

        // No se conservan tokens de Google: solo se necesitaba confirmar la identidad.
        return $this->user;
    }

    public function identity(): GoogleIdentity
    {
        $this->user();

        return $this->identity;
    }

    protected function getUserByToken($token): array
    {
        return [];
    }

    protected function mapUserToObject(array $user): SocialiteUser
    {
        return (new SocialiteUser)->setRaw($user);
    }
}
