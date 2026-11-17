<?php

namespace Tests\Feature\Users;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class AccountSettingsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCatalog();
        Storage::fake('local');
    }

    /** PNG real de 128×128 creado sin GD: getimagesize() lo reconoce. */
    private function png(int $size = 128): UploadedFile
    {
        $row = "\x00".str_repeat("\x2a\x6b\xc4", $size);
        $data = gzcompress(str_repeat($row, $size));
        $chunk = fn (string $type, string $body) => pack('N', strlen($body)).$type.$body.pack('N', crc32($type.$body));
        $binary = "\x89PNG\r\n\x1a\n"
            .$chunk('IHDR', pack('NNCCCCC', $size, $size, 8, 2, 0, 0, 0))
            .$chunk('IDAT', $data)
            .$chunk('IEND', '');

        return UploadedFile::fake()->createWithContent('foto.png', $binary);
    }

    #[Test]
    public function sube_y_reemplaza_la_foto_de_perfil(): void
    {
        $user = User::factory()->create();

        $first = $this->actingAs($user, 'sanctum')->post('/api/v1/account/avatar', ['avatar' => $this->png()], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('message', 'Foto de perfil actualizada.');
        $this->assertStringStartsWith("/api/v1/users/{$user->id}/avatar?v=", $first->json('data.avatar_url'));
        $oldPath = $user->fresh()->avatar_path;
        Storage::disk('local')->assertExists($oldPath);

        $this->actingAs($user, 'sanctum')->post('/api/v1/account/avatar', ['avatar' => $this->png(256)], ['Accept' => 'application/json'])->assertOk();
        Storage::disk('local')->assertMissing($oldPath);
        Storage::disk('local')->assertExists($user->fresh()->avatar_path);
        $this->assertTrue(AuditLog::query()->where('action', 'account.avatar_updated')->exists());
    }

    #[Test]
    public function rechaza_archivos_que_no_son_fotos(): void
    {
        $user = User::factory()->create();

        $svg = UploadedFile::fake()->createWithContent('foto.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        $this->actingAs($user, 'sanctum')->post('/api/v1/account/avatar', ['avatar' => $svg], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('avatar');

        $fakeImage = UploadedFile::fake()->createWithContent('foto.png', 'no soy una imagen');
        $this->actingAs($user, 'sanctum')->post('/api/v1/account/avatar', ['avatar' => $fakeImage], ['Accept' => 'application/json'])
            ->assertUnprocessable();

        $this->actingAs($user, 'sanctum')->post('/api/v1/account/avatar', ['avatar' => $this->png(16)], ['Accept' => 'application/json'])
            ->assertUnprocessable();

        $this->assertNull($user->fresh()->avatar_path);
    }

    #[Test]
    public function la_foto_solo_se_entrega_con_sesion(): void
    {
        $owner = User::factory()->create();
        $viewer = User::factory()->create();
        $this->actingAs($owner, 'sanctum')->post('/api/v1/account/avatar', ['avatar' => $this->png()], ['Accept' => 'application/json']);

        $this->actingAs($viewer, 'sanctum')->get("/api/v1/users/{$owner->id}/avatar")
            ->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        $this->actingAs($viewer, 'sanctum')->get("/api/v1/users/{$viewer->id}/avatar")->assertNotFound();

        $this->app['auth']->forgetGuards();
        $this->getJson("/api/v1/users/{$owner->id}/avatar")->assertUnauthorized();
    }

    #[Test]
    public function elimina_la_foto_de_perfil(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user, 'sanctum')->post('/api/v1/account/avatar', ['avatar' => $this->png()], ['Accept' => 'application/json']);
        $path = $user->fresh()->avatar_path;

        $this->actingAs($user, 'sanctum')->deleteJson('/api/v1/account/avatar')
            ->assertOk()
            ->assertJsonPath('data.avatar_url', null);

        Storage::disk('local')->assertMissing($path);
    }

    #[Test]
    public function guarda_la_preferencia_de_correos_y_solo_la_muestra_a_su_dueno(): void
    {
        $user = User::factory()->create();
        $admin = $this->superAdmin();

        $this->actingAs($user, 'sanctum')->putJson('/api/v1/account/preferences', ['notify_by_email' => false])
            ->assertOk()
            ->assertJsonPath('data.notify_by_email', false);
        $this->assertFalse($user->fresh()->notify_by_email);

        $this->actingAs($admin, 'sanctum')->getJson("/api/v1/users/{$user->id}")
            ->assertOk()
            ->assertJsonMissingPath('data.notify_by_email');
    }
}
