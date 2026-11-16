<?php

namespace App\Auth\Google;

use App\Auth\EntraId\AuthenticationFailed;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Http\Client\Factory as Http;
use Throwable;
use UnexpectedValueException;

/**
 * Valida el id_token (OpenID Connect) emitido por Google: firma RS256 con
 * las claves públicas de Google (JWKS), vigencia, emisor, audiencia, nonce,
 * correo verificado y dominio de Google Workspace (claim "hd").
 */
class GoogleIdTokenValidator
{
    private const CACHE_KEY = 'google:jwks';

    public function __construct(
        private readonly GoogleConfig $config,
        private readonly Http $http,
        private readonly Cache $cache,
    ) {}

    public function validate(string $idToken, ?string $expectedNonce): GoogleIdentity
    {
        $claims = $this->decode($idToken);

        if (($claims['aud'] ?? null) !== $this->config->clientId) {
            throw new AuthenticationFailed(AuthenticationFailed::INVALID_TOKEN, 'Audiencia (aud) inesperada.');
        }

        if (! in_array($claims['iss'] ?? null, GoogleConfig::ISSUERS, true)) {
            throw new AuthenticationFailed(AuthenticationFailed::INVALID_TOKEN, 'Emisor (iss) inesperado.');
        }

        if (! $expectedNonce || ! is_string($claims['nonce'] ?? null) || ! hash_equals($expectedNonce, $claims['nonce'])) {
            throw new AuthenticationFailed(AuthenticationFailed::INVALID_TOKEN, 'Nonce inválido.');
        }

        // Solo las cuentas administradas por Google Workspace traen "hd".
        // Una cuenta personal (Gmail) nunca lo trae, aunque su correo sea de
        // un dominio de la empresa.
        $hostedDomain = mb_strtolower((string) ($claims['hd'] ?? ''));
        if ($hostedDomain === '' || ! $this->config->allowsDomain($hostedDomain)) {
            throw new AuthenticationFailed(AuthenticationFailed::TENANT_MISMATCH, "Dominio de Workspace no permitido: '{$hostedDomain}'.");
        }

        $sub = (string) ($claims['sub'] ?? '');
        $email = mb_strtolower((string) ($claims['email'] ?? ''));

        if (! preg_match('/^[0-9]{1,64}$/', $sub) || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new AuthenticationFailed(AuthenticationFailed::INVALID_TOKEN, 'Faltan los claims sub o email.');
        }

        if (($claims['email_verified'] ?? false) !== true) {
            throw new AuthenticationFailed(AuthenticationFailed::INVALID_TOKEN, 'El correo no está verificado por Google.');
        }

        return new GoogleIdentity(
            subject: $sub,
            hostedDomain: $hostedDomain,
            email: $email,
            name: trim((string) ($claims['name'] ?? '')) ?: $email,
        );
    }

    /** @return array<string, mixed> */
    private function decode(string $idToken): array
    {
        JWT::$leeway = $this->config->clockLeeway;

        try {
            return (array) JWT::decode($idToken, $this->keys());
        } catch (UnexpectedValueException $e) {
            // Google rota sus claves con frecuencia: si el "kid" no está en
            // caché, se recargan una vez.
            if (str_contains($e->getMessage(), '"kid"')) {
                try {
                    return (array) JWT::decode($idToken, $this->keys(refresh: true));
                } catch (Throwable $retry) {
                    throw new AuthenticationFailed(AuthenticationFailed::INVALID_TOKEN, $retry->getMessage());
                }
            }

            throw new AuthenticationFailed(AuthenticationFailed::INVALID_TOKEN, $e->getMessage());
        } catch (AuthenticationFailed $e) {
            throw $e;
        } catch (Throwable $e) {
            throw new AuthenticationFailed(AuthenticationFailed::INVALID_TOKEN, $e->getMessage());
        }
    }

    /** @return array<string, \Firebase\JWT\Key> */
    private function keys(bool $refresh = false): array
    {
        if ($refresh) {
            $this->cache->forget(self::CACHE_KEY);
        }

        $jwks = $this->cache->remember(self::CACHE_KEY, $this->config->jwksCacheTtl, function () {
            $response = $this->http->timeout(10)->acceptJson()->get(GoogleConfig::JWKS_URL);

            if (! $response->successful() || ! is_array($response->json('keys'))) {
                throw new AuthenticationFailed(AuthenticationFailed::PROVIDER_ERROR, 'No fue posible obtener las claves públicas de Google (JWKS).');
            }

            return $response->json();
        });

        return JWK::parseKeySet($jwks, 'RS256');
    }
}
