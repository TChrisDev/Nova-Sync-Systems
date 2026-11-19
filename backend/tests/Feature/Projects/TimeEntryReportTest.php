<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Enums\TimeEntryStatus;
use App\Models\AuditLog;
use App\Models\Project;
use App\Models\Site;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\Support\ProjectsFixtures;
use Tests\TestCase;

/**
 * Reportes, bandeja de aprobación y exportación del registro de horas.
 * Fecha congelada: miércoles 21 de octubre de 2026 (el lunes 12 fue festivo).
 */
class TimeEntryReportTest extends TestCase
{
    use ProjectsFixtures, RefreshDatabase;

    private User $leader;

    private User $consultant;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpProjectsModule();
        $this->freezeBusinessTime();

        $this->leader = $this->userWithRole('lider-de-proyecto');
        $this->consultant = $this->userWithRole('consultor', hourlyCost: 60000);
        $this->project = $this->project($this->hourBagContract(), $this->leader);
        $this->allocate($this->consultant, $this->project, 100);
    }

    #[Test]
    public function el_reporte_agrupa_por_semana_con_festivos_y_capacidad_propia(): void
    {
        $this->entry($this->consultant, $this->project, TimeEntryStatus::Approved, ['work_date' => '2026-10-06', 'minutes' => 480]);
        $this->entry($this->consultant, $this->project, TimeEntryStatus::Submitted, ['work_date' => '2026-10-13', 'minutes' => 240]);
        $this->entry($this->consultant, $this->project, TimeEntryStatus::Draft, ['work_date' => '2026-10-17', 'minutes' => 90, 'is_after_hours' => true, 'is_on_call' => true]);
        $this->entry($this->consultant, $this->project, TimeEntryStatus::Rejected, ['work_date' => '2026-10-20', 'minutes' => 60]);

        $response = $this->actingAs($this->consultant, 'sanctum')
            ->getJson('/api/v1/time-entries/report?scope=mine&from=2026-10-05&to=2026-10-25')
            ->assertOk()
            ->assertJsonCount(3, 'data.weeks')
            ->assertJsonPath('data.totals.total_minutes', 870)
            ->assertJsonPath('data.people', 1);

        $weeks = collect($response->json('data.weeks'))->keyBy('week_start');

        $this->assertSame(480, $weeks['2026-10-05']['by_status']['approved']);
        $this->assertSame(5, $weeks['2026-10-05']['working_days']);
        $this->assertSame(42 * 60, $weeks['2026-10-05']['capacity_minutes']);

        // Semana del festivo: 4 días hábiles y la capacidad se ajusta.
        $holidayWeek = $weeks['2026-10-12'];
        $this->assertSame('2026-10-12', $holidayWeek['holidays'][0]['date']);
        $this->assertSame(4, $holidayWeek['working_days']);
        $this->assertSame((int) round(42 * 60 / 5 * 4), $holidayWeek['capacity_minutes']);
        $this->assertSame(330, $holidayWeek['total_minutes']);
        $this->assertSame(240, $holidayWeek['by_status']['submitted']);
        $this->assertSame(90, $holidayWeek['by_status']['draft']);
        $this->assertSame(90, $holidayWeek['after_hours_minutes']);
        $this->assertSame(90, $holidayWeek['on_call_minutes']);

        $this->assertSame(60, $weeks['2026-10-19']['by_status']['rejected']);
        $this->assertSame($this->project->id, $response->json('data.by_project.items.0.project.id'));
        $this->assertSame(480, $response->json('data.by_project.items.0.approved_minutes'));
    }

    #[Test]
    public function sin_rango_toma_las_ultimas_ocho_semanas_y_no_admite_mas_de_un_ano(): void
    {
        $this->actingAs($this->consultant, 'sanctum')
            ->getJson('/api/v1/time-entries/report')
            ->assertOk()
            ->assertJsonPath('data.range.from', '2026-08-31')
            ->assertJsonPath('data.range.to', '2026-10-25')
            ->assertJsonCount(8, 'data.weeks')
            ->assertJsonPath('data.weeks.7.total_minutes', 0);

        $this->getJson('/api/v1/time-entries/report?from=2025-01-01&to=2026-10-21')->assertJsonValidationErrors(['from']);
    }

    #[Test]
    public function cada_quien_ve_solo_su_alcance_y_el_costo_solo_con_permiso(): void
    {
        $foreign = $this->project($this->hourBagContract(), $this->userWithRole('lider-de-proyecto'));
        $this->allocate($this->consultant, $foreign, 50);
        $this->entry($this->consultant, $this->project, TimeEntryStatus::Approved, ['minutes' => 120, 'cost_rate' => 60000]);
        $this->entry($this->consultant, $foreign, TimeEntryStatus::Approved, ['minutes' => 60, 'cost_rate' => 60000]);

        // El consultor no ve las horas de todos.
        $this->actingAs($this->consultant, 'sanctum')->getJson('/api/v1/time-entries/report?scope=all')->assertForbidden();

        // El líder solo ve sus proyectos, sin capacidad ni costos.
        $leaderView = $this->actingAs($this->leader, 'sanctum')
            ->getJson('/api/v1/time-entries/report?scope=review&from=2026-10-19&to=2026-10-25')
            ->assertOk()
            ->assertJsonPath('data.totals.total_minutes', 120)
            ->assertJsonPath('data.weeks.0.capacity_minutes', null)
            ->assertJsonCount(1, 'data.by_project.items');
        $this->assertArrayNotHasKey('approved_cost', $leaderView->json('data.totals'));

        // Gerencia ve todo y el costo interno aprobado.
        $this->actingAs($this->userWithRole('gerencia'), 'sanctum')
            ->getJson('/api/v1/time-entries/report?scope=all&from=2026-10-19&to=2026-10-25')
            ->assertOk()
            ->assertJsonPath('data.totals.total_minutes', 180)
            ->assertJsonPath('data.totals.approved_cost', 180000)
            ->assertJsonPath('data.by_user.items.0.user.id', $this->consultant->id);
    }

    #[Test]
    public function el_filtro_por_sede_usa_el_perfil_de_la_persona(): void
    {
        $bogota = $this->userWithRole('consultor');
        $bogota->staffProfile->forceFill(['site_id' => Site::query()->where('code', 'bogota')->value('id')])->save();
        $this->allocate($bogota, $this->project, 50);
        $this->entry($this->consultant, $this->project, TimeEntryStatus::Approved, ['minutes' => 120]);
        $this->entry($bogota, $this->project, TimeEntryStatus::Approved, ['minutes' => 45]);

        $siteId = Site::query()->where('code', 'bogota')->value('id');
        $this->actingAs($this->userWithRole('gerencia'), 'sanctum')
            ->getJson("/api/v1/time-entries/report?scope=all&from=2026-10-19&to=2026-10-25&site_id={$siteId}")
            ->assertOk()
            ->assertJsonPath('data.totals.total_minutes', 45)
            ->assertJsonPath('data.people', 1);
    }

    #[Test]
    public function la_bandeja_agrupa_lo_enviado_por_persona_y_proyecto(): void
    {
        $other = $this->userWithRole('consultor');
        $this->allocate($other, $this->project, 50);
        $a = $this->entry($this->consultant, $this->project, TimeEntryStatus::Submitted, ['work_date' => '2026-10-13', 'minutes' => 120]);
        $b = $this->entry($this->consultant, $this->project, TimeEntryStatus::Submitted, ['work_date' => '2026-10-15', 'minutes' => 60, 'is_after_hours' => true]);
        $this->entry($other, $this->project, TimeEntryStatus::Submitted, ['minutes' => 30]);
        $this->entry($this->consultant, $this->project, TimeEntryStatus::Draft, ['minutes' => 240]); // no se ha enviado
        $this->entry($this->leader, $this->project, TimeEntryStatus::Submitted, ['minutes' => 300]); // las propias no se aprueban

        $response = $this->actingAs($this->leader, 'sanctum')
            ->getJson('/api/v1/time-entries/review-queue')
            ->assertOk()
            ->assertJsonCount(2, 'data.groups')
            ->assertJsonPath('data.totals.entries', 3)
            ->assertJsonPath('data.totals.minutes', 210)
            ->assertJsonPath('data.totals.people', 2)
            ->assertJsonPath('data.totals.oldest_date', '2026-10-13')
            ->assertJsonPath('data.groups.0.user.id', $this->consultant->id)
            ->assertJsonPath('data.groups.0.minutes', 180)
            ->assertJsonPath('data.groups.0.after_hours_minutes', 60)
            ->assertJsonPath('data.groups.0.from', '2026-10-13')
            ->assertJsonPath('data.groups.0.to', '2026-10-15');

        $this->assertEqualsCanonicalizing([$a->id, $b->id], $response->json('data.groups.0.ids'));

        // Los ids del grupo sirven tal cual para aprobar.
        $this->postJson('/api/v1/time-entries/approve', ['ids' => $response->json('data.groups.0.ids')])->assertOk()->assertJsonPath('data.count', 2);

        $this->actingAs($this->consultant, 'sanctum')->getJson('/api/v1/time-entries/review-queue')->assertForbidden();
    }

    #[Test]
    public function la_exportacion_respeta_el_alcance_neutraliza_formulas_y_queda_en_auditoria(): void
    {
        $this->entry($this->consultant, $this->project, TimeEntryStatus::Approved, ['minutes' => 90, 'description' => '=HIPERVINCULO("x")', 'cost_rate' => 60000]);
        $this->entry($this->leader, $this->project, TimeEntryStatus::Approved, ['minutes' => 30]);

        $csv = $this->actingAs($this->consultant, 'sanctum')
            ->get('/api/v1/time-entries/export?scope=mine')
            ->assertOk()
            ->assertHeader('content-type', 'text/csv; charset=UTF-8')
            ->streamedContent();

        $lines = array_values(array_filter(explode("\n", trim($csv))));
        $this->assertCount(2, $lines); // encabezado + su único registro
        $this->assertStringContainsString('Fecha;Persona', $lines[0]);
        $this->assertStringNotContainsString('Costo interno', $lines[0]);
        $this->assertStringContainsString('1,50', $lines[1]);
        $this->assertStringContainsString("'=HIPERVINCULO", $lines[1]);

        $log = AuditLog::query()->where('action', 'time_entries.exported')->sole();
        $this->assertSame(1, $log->metadata['rows']);
        $this->assertFalse($log->metadata['with_financials']);

        $gerencia = $this->actingAs($this->userWithRole('gerencia'), 'sanctum')
            ->get('/api/v1/time-entries/export?scope=all')
            ->assertOk()
            ->streamedContent();
        $this->assertStringContainsString('Costo interno (COP)', $gerencia);
        $this->assertStringContainsString(';90000', $gerencia);

        $this->actingAs($this->consultant, 'sanctum')->get('/api/v1/time-entries/export?scope=all')->assertForbidden();
    }
}
