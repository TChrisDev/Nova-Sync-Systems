<?php

namespace Tests\Feature\Realtime;

use App\Models\OutboxEvent;
use App\Models\StaffProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\Support\ProjectsFixtures;
use Tests\TestCase;

class DomainEventsTest extends TestCase
{
    use ProjectsFixtures, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCatalog();
        $this->setUpProjectsModule();
        config(['nova.events.enabled' => true]);
        OutboxEvent::query()->delete();
    }

    private function eventsOfType(string $type)
    {
        return OutboxEvent::query()->where('type', $type)->orderBy('id')->get();
    }

    #[Test]
    public function no_registra_nada_si_los_eventos_estan_apagados(): void
    {
        config(['nova.events.enabled' => false]);

        $this->client();

        $this->assertSame(0, OutboxEvent::query()->count());
    }

    #[Test]
    public function un_cambio_de_negocio_deja_un_evento_en_su_topico(): void
    {
        $client = $this->client();

        $event = $this->eventsOfType('client.created')->sole();
        $this->assertSame('nova.clients', $event->topic);
        $this->assertSame("client:{$client->id}", $event->message_key);
        $this->assertSame($event->event_id, $event->payload['event_id']);
        $this->assertSame(['type' => 'client', 'id' => $client->id], $event->payload['aggregate']);
        $this->assertNull($event->published_at);
    }

    #[Test]
    public function solo_publica_los_nombres_de_los_campos_que_cambiaron(): void
    {
        $client = $this->client();
        $client->forceFill(['name' => 'Nuevo nombre'])->save();

        $event = $this->eventsOfType('client.updated')->sole();
        $this->assertSame(['name'], $event->payload['changed']);
        $this->assertStringNotContainsString('Nuevo nombre', json_encode($event->payload));
    }

    #[Test]
    public function no_publica_costos_ni_cambios_irrelevantes(): void
    {
        $user = $this->userWithRole('consultor');
        OutboxEvent::query()->delete();

        $user->forceFill(['last_login_at' => now()])->save();
        $this->assertSame(0, OutboxEvent::query()->count());

        $profile = StaffProfile::query()->where('user_id', $user->id)->firstOrFail();
        $profile->forceFill(['hourly_cost' => 999999])->save();

        $event = $this->eventsOfType('staff_profile.updated')->sole();
        $this->assertSame([], $event->payload['changed']);
        $this->assertStringNotContainsString('999999', json_encode($event->payload));
        $this->assertSame([$user->id], $event->payload['audience']['user_ids']);
    }

    #[Test]
    public function el_evento_se_revierte_con_la_transaccion(): void
    {
        try {
            DB::transaction(function () {
                $this->client();
                throw new RuntimeException('falla después del cambio');
            });
        } catch (RuntimeException) {
        }

        $this->assertSame(0, OutboxEvent::query()->count());
    }

    #[Test]
    public function las_horas_avisan_al_consultor_y_al_lider_del_proyecto(): void
    {
        $leader = $this->userWithRole('lider-de-proyecto');
        $consultant = $this->userWithRole('consultor');
        $project = $this->project($this->hourBagContract(), $leader);

        $entry = $this->entry($consultant, $project);

        $event = $this->eventsOfType('time_entry.created')->sole();
        $this->assertSame('nova.timesheets', $event->topic);
        $this->assertEqualsCanonicalizing([$consultant->id, $leader->id], $event->payload['audience']['user_ids']);
        $this->assertSame(['project_id' => $project->id, 'user_id' => $consultant->id], $event->payload['refs']);
        $this->assertSame($entry->id, $event->payload['aggregate']['id']);
    }

    #[Test]
    public function cambiar_los_permisos_de_un_rol_avisa_a_quienes_lo_tienen(): void
    {
        $admin = $this->superAdmin();
        $member = $this->userWith(['users.view']);
        $role = $member->roles()->firstOrFail();
        OutboxEvent::query()->delete();

        $this->actingAs($admin, 'web')
            ->withHeader('Referer', 'http://localhost:5173/app')
            ->putJson("/api/v1/roles/{$role->id}/permissions", ['permission_ids' => $this->permissionIds(['users.view', 'audit.view'])])
            ->assertOk();

        $event = $this->eventsOfType('role.permissions_changed')->sole();
        $this->assertSame('nova.access_control', $event->topic);
        $this->assertSame([$member->id], $event->payload['audience']['user_ids']);
        $this->assertSame($admin->id, $event->payload['actor_id']);
    }

    #[Test]
    public function asignar_roles_avisa_a_la_persona(): void
    {
        $admin = $this->superAdmin();
        $target = User::factory()->create();
        $role = $this->roleWith(['users.view']);
        OutboxEvent::query()->delete();

        $this->actingAs($admin, 'web')
            ->withHeader('Referer', 'http://localhost:5173/app')
            ->putJson("/api/v1/users/{$target->id}/roles", ['role_ids' => [$role->id]])
            ->assertOk();

        $event = $this->eventsOfType('user.roles_changed')->sole();
        $this->assertSame([$target->id], $event->payload['audience']['user_ids']);
    }

    #[Test]
    public function limpia_solo_los_eventos_ya_publicados(): void
    {
        $this->client();
        $this->client();
        [$old, $pending] = OutboxEvent::query()->orderBy('id')->get()->all();
        $old->forceFill(['published_at' => now()->subDays(10)])->save();

        $this->artisan('nova:outbox-prune')->assertSuccessful();

        $this->assertNull(OutboxEvent::query()->find($old->id));
        $this->assertNotNull(OutboxEvent::query()->find($pending->id));
    }
}
