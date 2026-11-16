<?php

namespace Tests\Feature\Auth;

use App\Auth\Google\GoogleConfig;
use App\Auth\Google\GoogleIdTokenValidator;
use App\Auth\Google\GoogleWorkspaceProvider;
use App\Models\AuditLog;
use App\Models\User;
use Firebase\JWT\JWT;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Socialite\Facades\Socialite;
use PHPUnit\Framework\Attributes\Test;
use Tests\Support\EntraIdTokens;
use Tests\TestCase;

class GoogleLoginTest extends TestCase
{
    use EntraIdTokens, RefreshDatabase;

    private const CALLBACK = '/auth/google/callback';

    private const CLIENT_ID = '123456789-abcdef.apps.googleusercontent.com';

    private array $googleKey;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCatalog();
        $this->configureEntraId(); // genera la clave RSA de prueba y la URL del frontend

        config([
            'services.google.client_id' => self::CLIENT_ID,
            'services.google.client_secret' => 'test-secret-not-real',
            'services.google.redirect' => 'http://localhost:5173/auth/google/callback',
            'services.google.workspace_domains' => 'empresa.test',
        ]);

        $this->googleKey = $this->makeRsaKey('google-kid-1');
        Http::fake([GoogleConfig::JWKS_URL => Http::response(['keys' => [$this->googleKey['jwk']]])]);
    }

    private function googleToken(array $overrides = []): string
    {
        $now = time();

        $claims = array_merge([
            'iss' => 'https://accounts.google.com',
            'aud' => self::CLIENT_ID,
            'iat' => $now,
            'exp' => $now + 3600,
            'sub' => '110248495921238986420',
            'hd' => 'empresa.test',
            'email' => 'Laura.Gomez@empresa.test',
            'email_verified' => true,
            'name' => 'Laura Gómez',
            'nonce' => 'expected-nonce',
        ], $overrides);

        return JWT::encode(array_filter($claims, fn ($v) => $v !== null), $this->googleKey['private'], 'RS256', 'google-kid-1');
    }

    private function returnFromGoogle(string $idToken, string $nonce = 'expected-nonce')
    {
        $client = new Client(['handler' => HandlerStack::create(new MockHandler([
            new Response(200, ['Content-Type' => 'application/json'], json_encode([
                'token_type' => 'Bearer',
                'access_token' => 'not-used',
                'id_token' => $idToken,
            ])),
        ]))]);

        Socialite::forgetDrivers();
        Socialite::extend('google-workspace', function ($app) use ($client) {
            $config = $app->make(GoogleConfig::class);

            return Socialite::buildProvider(GoogleWorkspaceProvider::class, [
                'client_id' => $config->clientId,
                'client_secret' => $config->clientSecret,
                'redirect' => $config->redirectUri,
            ])->withGoogleConfig($config, $app->make(GoogleIdTokenValidator::class))->setHttpClient($client);
        });

        return $this->withSession(['state' => 'state-123', 'google_nonce' => $nonce, 'code_verifier' => 'verifier'])
            ->get(self::CALLBACK.'?code=auth-code&state=state-123');
    }

    #[Test]
    public function informa_los_proveedores_configurados(): void
    {
        $this->getJson('/api/v1/auth/config')
            ->assertOk()
            ->assertJsonPath('data.configured', true)
            ->assertJsonPath('data.providers.1.id', 'google')
            ->assertJsonPath('data.providers.1.configured', true)
            ->assertJsonPath('data.providers.1.login_url', '/auth/google/redirect');
    }

    #[Test]
    public function exige_al_menos_un_dominio_de_workspace(): void
    {
        config(['services.google.workspace_domains' => '']);

        $this->get('/auth/google/redirect')
            ->assertRedirect('http://localhost:5173/login?error=not_configured');
        $this->getJson('/api/v1/auth/config')->assertJsonPath('data.providers.1.configured', false);

        config(['services.google.workspace_domains' => 'gmail.com']);
        $this->getJson('/api/v1/auth/config')->assertJsonPath('data.providers.1.configured', false);
    }

    #[Test]
    public function redirige_a_google_con_pkce_state_nonce_y_dominio(): void
    {
        $location = $this->get('/auth/google/redirect')->headers->get('Location');

        $this->assertStringStartsWith(GoogleConfig::AUTHORIZE_URL.'?', $location);
        parse_str(parse_url($location, PHP_URL_QUERY), $query);
        $this->assertSame(self::CLIENT_ID, $query['client_id']);
        $this->assertSame('S256', $query['code_challenge_method']);
        $this->assertSame('empresa.test', $query['hd']);
        $this->assertSame(session('state'), $query['state']);
        $this->assertSame(session('google_nonce'), $query['nonce']);
        $this->assertArrayNotHasKey('client_secret', $query);
    }

    #[Test]
    public function un_usuario_autorizado_inicia_sesion_y_se_vincula_su_cuenta_de_google(): void
    {
        $user = User::factory()->create(['email' => 'laura.gomez@empresa.test', 'name' => 'Pendiente']);

        $this->returnFromGoogle($this->googleToken())
            ->assertRedirect('http://localhost:5173/app');

        $this->assertAuthenticatedAs($user->fresh(), 'web');
        $user->refresh();
        $this->assertSame('110248495921238986420', $user->google_sub);
        $this->assertSame('empresa.test', $user->google_hosted_domain);
        $this->assertSame('Laura Gómez', $user->name);
        $this->assertTrue(AuditLog::query()->where('action', 'auth.login')->where('metadata->provider', 'google')->exists());
    }

    #[Test]
    public function la_misma_persona_puede_usar_microsoft_y_google(): void
    {
        $user = User::factory()->create([
            'email' => 'laura.gomez@empresa.test',
            'microsoft_oid' => '0f0f0f0f-1111-2222-3333-444444444444',
        ]);

        $this->returnFromGoogle($this->googleToken())->assertRedirect('http://localhost:5173/app');

        $user->refresh();
        $this->assertSame('0f0f0f0f-1111-2222-3333-444444444444', $user->microsoft_oid);
        $this->assertSame('110248495921238986420', $user->google_sub);
    }

    #[Test]
    public function rechaza_cuentas_personales_sin_dominio_de_workspace(): void
    {
        User::factory()->create(['email' => 'laura.gomez@empresa.test']);

        $this->returnFromGoogle($this->googleToken(['hd' => null]))
            ->assertRedirect('http://localhost:5173/login?error=tenant_mismatch');
        $this->assertGuest('web');
    }

    #[Test]
    public function rechaza_otros_dominios_de_workspace(): void
    {
        User::factory()->create(['email' => 'laura.gomez@empresa.test']);

        $this->returnFromGoogle($this->googleToken(['hd' => 'otraempresa.test']))
            ->assertRedirect('http://localhost:5173/login?error=tenant_mismatch');
        $this->assertGuest('web');
    }

    #[Test]
    public function rechaza_correos_no_verificados(): void
    {
        User::factory()->create(['email' => 'laura.gomez@empresa.test']);

        $this->returnFromGoogle($this->googleToken(['email_verified' => false]))
            ->assertRedirect('http://localhost:5173/login?error=invalid_token');
        $this->assertGuest('web');
    }

    #[Test]
    public function rechaza_tokens_para_otra_aplicacion_o_emisor(): void
    {
        User::factory()->create(['email' => 'laura.gomez@empresa.test']);

        $this->returnFromGoogle($this->googleToken(['aud' => 'otra-app.apps.googleusercontent.com']))
            ->assertRedirect('http://localhost:5173/login?error=invalid_token');

        $this->returnFromGoogle($this->googleToken(['iss' => 'https://evil.example']))
            ->assertRedirect('http://localhost:5173/login?error=invalid_token');

        $this->assertGuest('web');
    }

    #[Test]
    public function rechaza_un_nonce_de_otra_sesion(): void
    {
        User::factory()->create(['email' => 'laura.gomez@empresa.test']);

        $this->returnFromGoogle($this->googleToken(), nonce: 'nonce-de-otra-sesion')
            ->assertRedirect('http://localhost:5173/login?error=invalid_token');
        $this->assertGuest('web');
    }

    #[Test]
    public function rechaza_un_correo_vinculado_a_otra_cuenta_de_google(): void
    {
        User::factory()->create(['email' => 'laura.gomez@empresa.test']);
        User::query()->where('email', 'laura.gomez@empresa.test')->update(['google_sub' => '999']);

        $this->returnFromGoogle($this->googleToken())
            ->assertRedirect('http://localhost:5173/login?error=account_mismatch');
        $this->assertGuest('web');
    }

    #[Test]
    public function rechaza_cuentas_no_autorizadas_previamente(): void
    {
        $this->returnFromGoogle($this->googleToken())
            ->assertRedirect('http://localhost:5173/login?error=not_authorized');

        $this->assertDatabaseCount('users', 0);
        $this->assertTrue(AuditLog::query()->where('action', 'auth.login_rejected')->where('metadata->provider', 'google')->exists());
    }
}
