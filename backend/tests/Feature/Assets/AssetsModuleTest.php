<?php

declare(strict_types=1);

namespace Tests\Feature\Assets;

use App\Enums\IncidentStatus;
use App\Enums\ProjectKind;
use App\Models\Alert;
use App\Models\Asset;
use App\Models\AssetLink;
use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Incident;
use App\Models\Project;
use App\Models\TelemetryReading;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use PHPUnit\Framework\Attributes\Test;
use Tests\Support\ProjectsFixtures;
use Tests\TestCase;

/**
 * Activos y monitoreo con archivos de Excel de prueba (tests/Fixtures/assets)
 * que copian la estructura de los archivos reales del laboratorio de red.
 */
class AssetsModuleTest extends TestCase
{
    use ProjectsFixtures, RefreshDatabase;

    private User $manager;

    private Client $clinic;

    private Project $support;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpProjectsModule();
        $this->freezeBusinessTime();

        $this->manager = $this->userWithRole('gerencia');
        $contract = $this->hourBagContract();
        $this->clinic = $contract->client;
        $this->support = $this->project($contract, $this->userWithRole('lider-de-proyecto'), ['kind' => ProjectKind::OngoingService]);
    }

    private function upload(string $name): UploadedFile
    {
        $path = base_path("tests/Fixtures/assets/{$name}");

        return new UploadedFile($path, $name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);
    }

    private function import(bool $dryRun, ?User $as = null): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($as ?? $this->manager, 'sanctum')->post('/api/v1/assets/import', [
            'client_id' => $this->clinic->id,
            'files' => [$this->upload('inventario.xlsx'), $this->upload('iot.xlsx')],
            'dry_run' => $dryRun ? '1' : '0',
        ], ['Accept' => 'application/json']);
    }

    #[Test]
    public function la_vista_previa_no_guarda_nada_y_la_importacion_no_duplica(): void
    {
        $preview = $this->import(true)->assertOk()
            ->assertJsonPath('data.dry_run', true)
            ->assertJsonPath('data.counts.assets_created', 10)
            ->assertJsonPath('data.counts.links_created', 5)
            ->assertJsonPath('data.counts.readings_created', 12)
            ->assertJsonPath('data.counts.alerts', 3)
            ->assertJsonPath('data.counts.incidents', 1);

        $warnings = implode("\n", $preview->json('data.warnings'));
        $this->assertStringContainsString('sin nombre', $warnings);
        $this->assertStringContainsString('Fantasma', $warnings);
        $this->assertStringContainsString('No existe', $warnings);
        $this->assertStringContainsString('fecha mala', $warnings);
        $this->assertStringContainsString('IOT-99', $warnings);
        $this->assertSame(0, Asset::query()->count(), 'La vista previa no debe guardar.');

        $this->import(false)->assertOk()->assertJsonPath('data.counts.assets_created', 10);
        $this->assertSame(10, Asset::query()->count());
        $this->assertSame(12, TelemetryReading::query()->count());
        $this->assertTrue(AuditLog::query()->where('action', 'assets.imported')->exists());

        // Segunda vez: actualiza, no duplica, y no repite alertas ni incidentes.
        $this->import(false)->assertOk()
            ->assertJsonPath('data.counts.assets_created', 0)
            ->assertJsonPath('data.counts.assets_updated', 10)
            ->assertJsonPath('data.counts.readings_existing', 12)
            ->assertJsonPath('data.counts.alerts', 0)
            ->assertJsonPath('data.counts.incidents', 0);
        $this->assertSame(10, Asset::query()->count());
        $this->assertSame(1, Incident::query()->count());

        // Lo importado quedó bien interpretado.
        $core = Asset::query()->where('name', 'Core0')->sole();
        $this->assertSame('switch_l3', $core->category->value);
        $this->assertSame(['10.0.0.2', '10.0.0.9'], $core->ip_addresses);
        $this->assertTrue($core->monitoring['syslog']);
        $this->assertSame('cctv', Asset::query()->where('name', 'Camara Lobby')->sole()->category->value);
        $this->assertSame('SMOKE', Asset::query()->where('name', 'HUMO_B')->value('reading_type'));
        $this->assertSame(5, AssetLink::query()->count());
    }

    #[Test]
    public function tres_sensores_a_la_vez_son_un_solo_incidente_en_el_proyecto_de_soporte(): void
    {
        $this->import(false)->assertOk();

        $incident = Incident::query()->sole();
        $this->assertStringContainsString('Humo detectado en 2 equipos', $incident->title);
        $this->assertSame($this->support->id, $incident->project_id);
        $this->assertSame(IncidentStatus::Open, $incident->status);
        $this->assertSame(2, $incident->alerts()->count());
        $this->assertStringStartsWith('INC-2026-', $incident->code);

        $this->getJson("/api/v1/incidents/{$incident->id}")
            ->assertOk()
            ->assertJsonCount(2, 'data.alerts')
            ->assertJsonPath('data.project.id', $this->support->id);
    }

    #[Test]
    public function los_datos_tecnicos_y_las_escrituras_dependen_del_permiso(): void
    {
        $this->import(false)->assertOk();

        // Comercial ve el inventario pero no IP, MAC ni seriales, y no edita.
        $commercial = $this->userWithRole('comercial');
        $row = $this->actingAs($commercial, 'sanctum')
            ->getJson("/api/v1/assets?client_id={$this->clinic->id}&search=router")
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Router0')
            ->json('data.0');
        $this->assertArrayNotHasKey('ip_addresses', $row);
        $this->assertArrayNotHasKey('serial', $row);
        $this->postJson('/api/v1/assets', ['client_id' => $this->clinic->id, 'name' => 'Nuevo', 'category' => 'pc', 'criticality' => 'low'])->assertForbidden();

        // Buscar por IP solo funciona para quien puede verlas.
        $this->getJson("/api/v1/assets?client_id={$this->clinic->id}&search=200.10")->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->manager, 'sanctum')
            ->getJson("/api/v1/assets?client_id={$this->clinic->id}&search=200.10")
            ->assertOk()
            ->assertJsonPath('data.0.ip_addresses.0', '200.10.10.1');

        // Un consultor atiende incidentes pero no importa.
        $this->import(true, $this->userWithRole('consultor'))->assertForbidden();

        // Sin el módulo, nada.
        $this->actingAs($this->userWith(['clients.view']), 'sanctum')->getJson("/api/v1/assets?client_id={$this->clinic->id}")->assertForbidden();
    }

    #[Test]
    public function registrar_editar_y_eliminar_un_equipo_con_validacion_de_ip(): void
    {
        $this->actingAs($this->manager, 'sanctum');

        $this->postJson('/api/v1/assets', [
            'client_id' => $this->clinic->id, 'name' => 'Firewall nuevo', 'category' => 'firewall', 'criticality' => 'critical',
            'ip_addresses' => ['300.1.1.1'],
        ])->assertJsonValidationErrors(['ip_addresses.0']);

        $id = $this->postJson('/api/v1/assets', [
            'client_id' => $this->clinic->id, 'name' => 'Firewall nuevo', 'category' => 'firewall', 'criticality' => 'critical',
            'ip_addresses' => ['10.1.1.1'], 'mac_addresses' => ['00:1A:2B:3C:4D:5E'],
            'monitoring' => ['syslog' => true, 'ssh' => true],
        ])->assertCreated()->assertJsonPath('data.monitoring_count', 2)->json('data.id');

        $this->putJson("/api/v1/assets/{$id}", ['criticality' => 'high', 'monitoring' => ['syslog' => true, 'ssh' => true, 'snmp' => true]])
            ->assertOk()
            ->assertJsonPath('data.criticality.value', 'high')
            ->assertJsonPath('data.monitoring_count', 3);

        $this->deleteJson("/api/v1/assets/{$id}")->assertOk();
        $this->assertDatabaseMissing('assets', ['id' => $id]);
        $this->assertSame(['asset.created', 'asset.updated', 'asset.deleted'], AuditLog::query()->where('action', 'like', 'asset.%')->orderBy('id')->pluck('action')->all());
    }

    #[Test]
    public function panel_mapa_y_cobertura_salen_de_los_datos_importados(): void
    {
        $this->import(false)->assertOk();
        $this->actingAs($this->manager, 'sanctum');

        $this->getJson("/api/v1/assets/dashboard?client_id={$this->clinic->id}")
            ->assertOk()
            ->assertJsonPath('data.totals.assets', 10)
            ->assertJsonPath('data.totals.critical', 3)
            ->assertJsonPath('data.coverage.devices', 4)
            ->assertJsonPath('data.coverage.possible', 20)
            ->assertJsonPath('data.coverage.configured', 4)
            ->assertJsonPath('data.incidents.open', 1)
            ->assertJsonPath('data.by_criticality.0.count', 3);

        // Las alertas en el tiempo suman lo mismo que el total, por severidad.
        $dashboard = $this->getJson("/api/v1/assets/dashboard?client_id={$this->clinic->id}")->json('data');
        $timeline = $dashboard['alerts']['timeline'];
        $this->assertSame(15, $timeline['bucket_minutes']);
        $this->assertSame($dashboard['alerts']['total'], collect($timeline['points'])->sum(fn (array $p) => $p['critical'] + $p['warning'] + $p['info']));

        $map = $this->getJson("/api/v1/assets/map?client_id={$this->clinic->id}")->assertOk();
        $this->assertCount(4, $map->json('data.nodes'));
        $this->assertCount(3, $map->json('data.edges'));
        $switch = collect($map->json('data.nodes'))->firstWhere('name', 'SW1 P1');
        $this->assertSame(2, $switch['endpoint_total']);
        $this->assertSame(['ASA0', 'Core0'], collect($map->json('data.single_points'))->pluck('name')->sort()->values()->all());

        $coverage = $this->getJson("/api/v1/assets/coverage?client_id={$this->clinic->id}")->assertOk();
        $this->assertSame(0, collect($coverage->json('data.assets'))->firstWhere('name', 'SW1 P1')['configured']);
    }

    #[Test]
    public function las_reglas_se_editan_y_se_vuelven_a_evaluar(): void
    {
        $this->import(false)->assertOk();
        $this->actingAs($this->manager, 'sanctum');

        $rules = $this->getJson("/api/v1/alert-rules?client_id={$this->clinic->id}")->assertOk()->json('data');
        $temp = collect($rules)->firstWhere('reading_type', 'TEMP');
        $this->assertSame(1, $temp['alerts_count']);

        // Bajar el umbral a 23 °C: ahora 2 lecturas lo cumplen.
        $this->putJson("/api/v1/alert-rules/{$temp['id']}", ['threshold' => 23])->assertOk()->assertJsonPath('data.condition', '≥ 23 °C');
        $this->postJson('/api/v1/alert-rules/evaluate', ['client_id' => $this->clinic->id])->assertOk();
        $this->assertSame(2, Alert::query()->where('alert_rule_id', $temp['id'])->count());

        // La de humo originó un incidente: no se elimina, se desactiva.
        $smoke = collect($rules)->firstWhere('reading_type', 'SMOKE');
        $this->deleteJson("/api/v1/alert-rules/{$smoke['id']}")->assertStatus(409)->assertJsonPath('code', 'rule_in_use');

        $this->postJson('/api/v1/alert-rules', ['client_id' => $this->clinic->id, 'name' => 'Temperatura baja', 'reading_type' => 'TEMP', 'operator' => 'lt', 'threshold' => 18, 'severity' => 'info'])->assertCreated();
        $this->actingAs($this->userWithRole('consultor'), 'sanctum')
            ->postJson('/api/v1/alert-rules', ['name' => 'X', 'reading_type' => 'TEMP', 'operator' => 'lt', 'threshold' => 1, 'severity' => 'info'])
            ->assertForbidden();
    }

    #[Test]
    public function el_incidente_se_cierra_con_resolucion_y_suma_las_horas_registradas(): void
    {
        $this->import(false)->assertOk();
        $incident = Incident::query()->sole();
        $consultant = $this->userWithRole('consultor');
        $this->allocate($consultant, $this->support, 50);

        $this->actingAs($consultant, 'sanctum')
            ->patchJson("/api/v1/incidents/{$incident->id}", ['status' => 'in_progress'])
            ->assertOk()
            ->assertJsonPath('data.status.value', 'in_progress')
            ->assertJsonPath('data.assignee.id', $consultant->id);

        // Horas contra el incidente, en el proyecto de soporte del mismo cliente.
        $this->postJson('/api/v1/time-entries', [
            'project_id' => $this->support->id, 'work_date' => '2026-10-21', 'minutes' => 90,
            'description' => 'Revisión de sensores de humo', 'incident_id' => $incident->id,
        ])->assertCreated()->assertJsonPath('data.incident.code', $incident->code);

        // Un proyecto de otro cliente no puede llevar horas de este incidente.
        $other = $this->project($this->hourBagContract());
        $this->allocate($consultant, $other, 30);
        $this->postJson('/api/v1/time-entries', [
            'project_id' => $other->id, 'work_date' => '2026-10-21', 'minutes' => 30,
            'description' => 'No corresponde', 'incident_id' => $incident->id,
        ])->assertStatus(422)->assertJsonPath('code', 'incident_other_client');

        $this->patchJson("/api/v1/incidents/{$incident->id}", ['status' => 'false_positive'])->assertStatus(422)->assertJsonPath('code', 'resolution_required');
        $this->patchJson("/api/v1/incidents/{$incident->id}", ['status' => 'false_positive', 'resolution' => 'Prueba de alarma programada por el cliente.'])
            ->assertOk()
            ->assertJsonPath('data.is_closed', true);

        $this->getJson("/api/v1/incidents?client_id={$this->clinic->id}")
            ->assertOk()
            ->assertJsonPath('data.0.minutes', 90)
            ->assertJsonPath('data.0.status.value', 'false_positive');
    }

    #[Test]
    public function la_telemetria_agrupa_las_lecturas_por_bloques(): void
    {
        $this->import(false)->assertOk();
        $this->actingAs($this->manager, 'sanctum');

        $sensors = $this->getJson("/api/v1/telemetry/sensors?client_id={$this->clinic->id}")->assertOk()->assertJsonPath('data.range.readings', 12);
        $temp = collect($sensors->json('data.sensors'))->firstWhere('name', 'TEMP_A');
        $this->assertSame(22.0, (float) $temp['last_value']);

        $series = $this->getJson('/api/v1/telemetry/series?'.http_build_query(['client_id' => $this->clinic->id, 'asset_ids' => [$temp['id']], 'bucket' => 2]))->assertOk();
        $points = $series->json('data.series.0.points');
        $this->assertCount(2, $points); // 09:38-09:39 y 09:40-09:41
        $this->assertSame(24.0, (float) $points[1]['max']);
    }
}
