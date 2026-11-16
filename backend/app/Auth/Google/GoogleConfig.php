<?php

namespace App\Auth\Google;

/**
 * Configuración del inicio de sesión con Google Workspace.
 *
 * Se exige al menos un dominio de Workspace (claim "hd"): sin esa lista
 * cualquier cuenta de Gmail podría identificarse, el equivalente a aceptar
 * "common" en Entra ID.
 */
final class GoogleConfig
{
    public const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

    public const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    public const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

    /** Google emite id_tokens con cualquiera de estos dos emisores. */
    public const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

    private const DOMAIN = '/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/';

    /**
     * @param  list<string>  $workspaceDomains
     */
    public function __construct(
        public readonly ?string $clientId,
        public readonly ?string $clientSecret,
        public readonly ?string $redirectUri,
        public readonly array $workspaceDomains,
        public readonly int $jwksCacheTtl,
        public readonly int $clockLeeway,
    ) {}

    public static function fromConfig(): self
    {
        $c = config('services.google', []);

        $domains = is_array($c['workspace_domains'] ?? null)
            ? $c['workspace_domains']
            : explode(',', (string) ($c['workspace_domains'] ?? ''));

        return new self(
            clientId: self::clean($c['client_id'] ?? null),
            clientSecret: self::clean($c['client_secret'] ?? null),
            redirectUri: self::clean($c['redirect'] ?? null),
            workspaceDomains: array_values(array_unique(array_filter(array_map(
                fn ($domain) => mb_strtolower(trim((string) $domain)),
                $domains,
            )))),
            jwksCacheTtl: (int) ($c['jwks_cache_ttl'] ?? 21600),
            clockLeeway: (int) ($c['clock_leeway'] ?? 120),
        );
    }

    /** Lista de problemas de configuración; vacía si todo está completo. */
    public function problems(): array
    {
        $problems = [];

        if (! $this->clientId || ! str_ends_with($this->clientId, '.apps.googleusercontent.com')) {
            $problems[] = 'GOOGLE_CLIENT_ID debe ser el ID de cliente OAuth (termina en .apps.googleusercontent.com).';
        }
        if (! $this->clientSecret) {
            $problems[] = 'GOOGLE_CLIENT_SECRET no está definido.';
        }
        if (! $this->redirectUri || ! filter_var($this->redirectUri, FILTER_VALIDATE_URL)) {
            $problems[] = 'GOOGLE_REDIRECT_URI debe ser una URL absoluta registrada en Google Cloud.';
        }
        if ($this->workspaceDomains === []) {
            $problems[] = 'GOOGLE_WORKSPACE_DOMAINS debe listar al menos un dominio de Google Workspace.';
        }
        foreach ($this->workspaceDomains as $domain) {
            if (! preg_match(self::DOMAIN, $domain) || in_array($domain, ['gmail.com', 'googlemail.com'], true)) {
                $problems[] = "GOOGLE_WORKSPACE_DOMAINS contiene un dominio no válido: {$domain}.";
            }
        }

        return $problems;
    }

    public function isConfigured(): bool
    {
        return $this->problems() === [];
    }

    public function allowsDomain(string $domain): bool
    {
        return in_array(mb_strtolower($domain), $this->workspaceDomains, true);
    }

    private static function clean(mixed $value): ?string
    {
        $value = is_string($value) ? trim($value) : null;

        return $value === '' ? null : $value;
    }
}
