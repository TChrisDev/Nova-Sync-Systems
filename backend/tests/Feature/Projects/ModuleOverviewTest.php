<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Enums\TimeEntryStatus;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\Support\ProjectsFixtures;
use Tests\TestCase;

/**
 * Indicadores de los gráficos de Clientes y contratos y de Proyectos.
 * Fecha congelada: miércoles 21 de octubre de 2026.
 */
class ModuleOverviewTest extends TestCase
{
    use ProjectsFixtures, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpProjectsModule();
        $this->freezeBusinessTime();
    }

    #[Test]
    public function el_resumen_comercial_suma_mensualidades_bolsas_y_horas_por_mes(): void
    {
        $leader = $this->userWithRole('lider-de-proyecto');
        $consultant = $this->userWithRole('consultor');
        $bag = $this->hourBagContract(hours: 10, attributes: ['end_date' => '2026-11-10']);
        $monthly = $this->monthlyContract(fee: 12000000);
        $bagProject = $this->project($bag, $leader);
        $monthlyProject = $this->project($monthly, $leader);

        $this->entry($consultant, $bagProject, TimeEntryStatus::Approved, ['work_date' => '2026-09-15', 'minutes' => 300]);
        $this->entry($consultant, $bagProject, TimeEntryStatus::Approved, ['work_date' => '2026-10-06', 'minutes' => 240]);
        $this->entry($consultant, $monthlyProject, TimeEntryStatus::Approved, ['work_date' => '2026-10-07', 'minutes' => 120]);
        $this->entry($consultant, $monthlyProject, TimeEntryStatus::Submitted, ['work_date' => '2026-10-08', 'minutes' => 60]);

        $response = $this->actingAs($this->userWithRole('comercial'), 'sanctum')
            ->getJson('/api/v1/contracts/overview')
            ->assertOk()
            ->assertJsonPath('data.totals.open_contracts', 2)
            ->assertJsonPath('data.totals.monthly_recurring_amount', 12000000)
            ->assertJsonPath('data.bags.0.approved_minutes', 540)
            ->assertJsonPath('data.bags.0.consumed_ratio', 0.9)
            ->assertJsonPath('data.expiring.0.days_left', 20);

        $months = collect($response->json('data.monthly_hours'))->keyBy('month');
        $this->assertSame(['month' => '2026-09', 'hour_bag' => 300, 'monthly_recurring' => 0], $months['2026-09']);
        // Lo enviado aún no cuenta: solo lo aprobado.
        $this->assertSame(['month' => '2026-10', 'hour_bag' => 240, 'monthly_recurring' => 120], $months['2026-10']);
        $this->assertContains('bag_low', array_column($response->json('data.alerts'), 'code'));
        // Sin costos ni márgenes en el resumen.
        $this->assertStringNotContainsString('margin', $response->getContent());
    }

    #[Test]
    public function el_resumen_comercial_exige_permiso_de_clientes(): void
    {
        $this->actingAs($this->userWithRole('consultor'), 'sanctum')->getJson('/api/v1/contracts/overview')->assertForbidden();
    }

    #[Test]
    public function el_lider_solo_ve_los_indicadores_de_sus_proyectos(): void
    {
        $leader = $this->userWithRole('lider-de-proyecto');
        $other = $this->userWithRole('lider-de-proyecto');
        $consultant = $this->userWithRole('consultor');
        $mine = $this->project($this->hourBagContract(hours: 10), $leader, ['budget_minutes' => 600]);
        $theirs = $this->project($this->monthlyContract(), $other);
        $this->allocate($consultant, $mine);

        $this->entry($consultant, $mine, TimeEntryStatus::Approved, ['work_date' => '2026-10-19', 'minutes' => 480]);
        $this->entry($consultant, $mine, TimeEntryStatus::Submitted, ['work_date' => '2026-10-20', 'minutes' => 60]);
        $this->entry($consultant, $theirs, TimeEntryStatus::Approved, ['work_date' => '2026-10-20', 'minutes' => 300]);

        $response = $this->actingAs($leader, 'sanctum')
            ->getJson('/api/v1/projects/overview')
            ->assertOk()
            ->assertJsonPath('data.scope', 'led')
            ->assertJsonPath('data.totals.projects', 1)
            ->assertJsonPath('data.budgets.0.id', $mine->id)
            ->assertJsonPath('data.budgets.0.consumed_minutes', 540)
            ->assertJsonPath('data.health.warning', 1);

        $week = collect($response->json('data.weekly_hours'))->firstWhere('week_start', '2026-10-19');
        $this->assertSame(['week_start' => '2026-10-19', 'approved' => 480, 'submitted' => 60, 'draft' => 0], $week);

        $all = $this->actingAs($this->userWithRole('gerencia'), 'sanctum')->getJson('/api/v1/projects/overview')->assertOk();
        $this->assertSame('all', $all->json('data.scope'));
        $this->assertSame(2, $all->json('data.totals.projects'));
    }

    #[Test]
    public function los_indicadores_de_proyectos_exigen_permiso(): void
    {
        $this->actingAs($this->userWithRole('consultor'), 'sanctum')->getJson('/api/v1/projects/overview')->assertForbidden();
        $this->actingAs(User::factory()->create(), 'sanctum')->getJson('/api/v1/projects/overview')->assertForbidden();
    }
}
