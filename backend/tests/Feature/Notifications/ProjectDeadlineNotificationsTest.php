<?php

namespace Tests\Feature\Notifications;

use App\Enums\ProjectStatus;
use App\Models\OutboxEvent;
use App\Notifications\ProjectEndingSoon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use PHPUnit\Framework\Attributes\Test;
use Tests\Support\ProjectsFixtures;
use Tests\TestCase;

class ProjectDeadlineNotificationsTest extends TestCase
{
    use ProjectsFixtures, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpProjectsModule();
        $this->freezeBusinessTime('2026-10-21 08:00:00');
    }

    #[Test]
    public function avisa_al_lider_y_a_gerencia_cuando_el_proyecto_esta_por_vencer(): void
    {
        Notification::fake();
        $leader = $this->userWithRole('lider-de-proyecto');
        $manager = $this->userWithRole('gerencia');
        $consultant = $this->userWithRole('consultor');
        $project = $this->project($this->hourBagContract(), $leader, ['end_date' => '2026-10-28']);

        $this->artisan('nova:notify-project-deadlines')->assertSuccessful();

        Notification::assertSentTo($leader, ProjectEndingSoon::class, fn ($n) => $n->project->is($project) && $n->daysLeft === 7);
        Notification::assertSentTo($manager, ProjectEndingSoon::class);
        Notification::assertNotSentTo($consultant, ProjectEndingSoon::class);
    }

    #[Test]
    public function no_repite_el_mismo_aviso_y_vuelve_a_avisar_en_el_siguiente_umbral(): void
    {
        Notification::fake();
        $leader = $this->userWithRole('lider-de-proyecto');
        $this->project($this->hourBagContract(), $leader, ['end_date' => '2026-10-28']);

        $this->artisan('nova:notify-project-deadlines');
        $this->artisan('nova:notify-project-deadlines');
        Notification::assertSentToTimes($leader, ProjectEndingSoon::class, 1);

        $this->freezeBusinessTime('2026-10-27 08:00:00'); // falta 1 día
        $this->artisan('nova:notify-project-deadlines');
        Notification::assertSentToTimes($leader, ProjectEndingSoon::class, 2);
    }

    #[Test]
    public function ignora_proyectos_cerrados_lejanos_o_sin_fecha_de_fin(): void
    {
        Notification::fake();
        $leader = $this->userWithRole('lider-de-proyecto');
        $contract = $this->hourBagContract();
        $this->project($contract, $leader, ['end_date' => '2026-10-25', 'status' => ProjectStatus::Closed]);
        $this->project($contract, $leader, ['end_date' => '2026-12-31']);
        $this->project($contract, $leader, ['end_date' => null]);

        $this->artisan('nova:notify-project-deadlines');

        Notification::assertNothingSent();
    }

    #[Test]
    public function guarda_la_notificacion_en_la_campana_envia_correo_y_avisa_en_tiempo_real(): void
    {
        config(['nova.events.enabled' => true, 'mail.default' => 'array']);
        $leader = $this->userWithRole('lider-de-proyecto');
        $project = $this->project($this->hourBagContract(), $leader, ['end_date' => '2026-10-21']);

        $this->artisan('nova:notify-project-deadlines');

        $notification = $leader->notifications()->sole();
        $this->assertSame("El proyecto {$project->code} vence hoy", $notification->data['title']);
        $this->assertSame("/app/projects/{$project->id}", $notification->data['url']);
        $this->assertCount(1, app('mailer')->getSymfonyTransport()->messages());

        $event = OutboxEvent::query()->where('type', 'notification.created')->sole();
        $this->assertSame('nova.notifications', $event->topic);
        $this->assertSame([$leader->id], $event->payload['audience']['user_ids']);
    }

    #[Test]
    public function quien_desactiva_los_correos_solo_recibe_la_notificacion_en_la_campana(): void
    {
        config(['mail.default' => 'array']);
        $leader = $this->userWithRole('lider-de-proyecto');
        $leader->forceFill(['notify_by_email' => false])->save();
        $this->project($this->hourBagContract(), $leader, ['end_date' => '2026-10-22']);

        $this->artisan('nova:notify-project-deadlines');

        $this->assertSame(1, $leader->notifications()->count());
        $this->assertCount(0, app('mailer')->getSymfonyTransport()->messages());
    }

    #[Test]
    public function cada_persona_solo_ve_y_marca_sus_notificaciones(): void
    {
        $leader = $this->userWithRole('lider-de-proyecto');
        $other = $this->userWithRole('consultor');
        $this->project($this->hourBagContract(), $leader, ['end_date' => '2026-10-22']);
        $leader->forceFill(['notify_by_email' => false])->save();
        $this->artisan('nova:notify-project-deadlines');
        $id = $leader->notifications()->sole()->id;

        $this->actingAs($other, 'sanctum')->getJson('/api/v1/notifications')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($other, 'sanctum')->postJson("/api/v1/notifications/{$id}/read")->assertNotFound();

        $this->actingAs($leader, 'sanctum')->getJson('/api/v1/notifications')
            ->assertOk()
            ->assertJsonPath('meta.unread_count', 1)
            ->assertJsonPath('data.0.kind', 'project_ending');

        $this->actingAs($leader, 'sanctum')->postJson("/api/v1/notifications/{$id}/read")->assertOk();
        $this->actingAs($leader, 'sanctum')->getJson('/api/v1/notifications')->assertJsonPath('meta.unread_count', 0);
    }
}
