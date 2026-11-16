<?php

namespace Tests\Feature\Realtime;

use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class RealtimeTicketTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-realtime-secret-0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCatalog();
        config(['nova.events.enabled' => true, 'nova.realtime.secret' => self::SECRET]);
    }

    private function requestTicket($user)
    {
        return $this->actingAs($user, 'web')
            ->withHeader('Referer', 'http://localhost:5173/app')
            ->postJson('/api/v1/realtime/ticket');
    }

    /** @return array<string, mixed> */
    private function verify(string $ticket): array
    {
        [$version, $body, $signature] = explode('.', $ticket);
        $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', "{$version}.{$body}", self::SECRET, true)), '+/', '-_'), '=');
        $this->assertSame('v1', $version);
        $this->assertTrue(hash_equals($expected, $signature), 'Firma del ticket inválida.');

        return json_decode(base64_decode(strtr($body, '-_', '+/')), true);
    }

    #[Test]
    public function exige_sesion(): void
    {
        $this->postJson('/api/v1/realtime/ticket')->assertUnauthorized();
    }

    #[Test]
    public function responde_503_si_el_tiempo_real_no_esta_configurado(): void
    {
        config(['nova.realtime.secret' => 'corta']);

        $this->requestTicket($this->userWith(['users.view']))
            ->assertStatus(503)
            ->assertJsonPath('code', 'realtime_unavailable');
    }

    #[Test]
    public function emite_un_ticket_firmado_con_los_modulos_que_puede_seguir(): void
    {
        $user = $this->userWith(['users.view', 'timesheets.create', 'timesheets.approve_any']);

        $response = $this->requestTicket($user)
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.stream_url', '/realtime/stream');

        $claims = $this->verify($response->json('data.ticket'));
        $this->assertSame($user->id, $claims['uid']);
        $this->assertEqualsCanonicalizing(['users', 'timesheets'], $claims['scopes']);
        $this->assertSame(60, $claims['exp'] - $claims['iat']);
        $this->assertSame(900, $claims['sx'] - $claims['iat']);
    }

    #[Test]
    public function un_super_admin_sigue_todos_los_modulos(): void
    {
        $claims = $this->verify($this->requestTicket($this->superAdmin())->json('data.ticket'));

        $this->assertEqualsCanonicalizing(['clients', 'projects', 'timesheets', 'users', 'access_control'], $claims['scopes']);
    }

    #[Test]
    public function una_cuenta_desactivada_no_recibe_ticket(): void
    {
        $user = $this->userWith(['users.view'], ['is_active' => false]);

        $this->requestTicket($user)->assertForbidden();
    }
}
