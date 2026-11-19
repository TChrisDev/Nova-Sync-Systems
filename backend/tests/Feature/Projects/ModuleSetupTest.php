<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Enums\ModuleStatus;
use App\Models\Module;
use App\Models\Permission;
use App\Models\Role;
use App\Models\Site;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class ModuleSetupTest extends TestCase
{
    use RefreshDatabase;

    #[Test]
    public function crea_sedes_y_plantillas_sin_pisar_los_ajustes_del_administrador(): void
    {
        $this->artisan('nova:setup-projects')->expectsOutputToContain('Roles creados: Gerencia, Subgerencia, Comercial, Líder de proyecto, Consultor.')->assertSuccessful();

        $this->assertSame(['medellin', 'bogota', 'remoto'], Site::query()->orderBy('sort_order')->pluck('code')->all());
        $consultant = Role::query()->where('slug', 'consultor')->firstOrFail();
        $consultantPermissions = ['assets.incidents', 'assets.technical', 'assets.view', 'timesheets.create'];
        $this->assertSame($consultantPermissions, $consultant->permissions()->orderBy('code')->pluck('code')->all());

        // El administrador le da un permiso extra al rol...
        $consultant->permissions()->attach(Permission::query()->where('code', 'projects.capacity')->value('id'), ['created_at' => now()]);

        // ...y volver a correr el comando no lo quita.
        $this->artisan('nova:setup-projects')->expectsOutputToContain('ya existían')->assertSuccessful();
        $this->assertCount(5, $consultant->permissions()->get());

        // Solo si se pide explícitamente.
        $this->artisan('nova:setup-projects --reset-permissions')->assertSuccessful();
        $this->assertSame($consultantPermissions, $consultant->permissions()->orderBy('code')->pluck('code')->all());
    }

    #[Test]
    public function activar_activos_agrega_sus_permisos_sin_tocar_los_demas(): void
    {
        $this->artisan('nova:setup-projects')->assertSuccessful();
        $leader = Role::query()->where('slug', 'lider-de-proyecto')->firstOrFail();

        // Una instalación anterior: el rol no tenía permisos de activos y el
        // administrador le quitó la aprobación de horas.
        $leader->permissions()->detach(Permission::query()->where('code', 'like', 'assets.%')->pluck('id'));
        $leader->permissions()->detach(Permission::query()->where('code', 'timesheets.approve')->value('id'));

        $this->artisan('nova:setup-assets')->expectsOutputToContain('Líder de proyecto')->assertSuccessful();

        $codes = $leader->permissions()->pluck('code');
        $this->assertTrue($codes->contains('assets.incidents'));
        $this->assertFalse($codes->contains('assets.delete'));
        $this->assertFalse($codes->contains('timesheets.approve'), 'No debe devolver permisos de otros módulos.');

        $this->artisan('nova:setup-assets')->expectsOutputToContain('ya tenían')->assertSuccessful();
    }

    #[Test]
    public function el_catalogo_retira_los_modulos_que_ya_no_se_desarrollaran(): void
    {
        $this->artisan('nova:sync-permissions')->assertSuccessful();

        // Un módulo que existía antes en la base de datos (de la versión anterior del catálogo).
        $old = new Module;
        $old->forceFill(['code' => 'inventory', 'name' => 'Inventario', 'status' => ModuleStatus::Planned, 'sort_order' => 1])->save();
        $permission = new Permission;
        $permission->forceFill(['module_id' => $old->id, 'action' => 'view', 'code' => 'inventory.view'])->save();

        $this->artisan('nova:sync-permissions')->expectsOutputToContain('inventory')->assertSuccessful();
        $this->assertModelExists($old);

        $this->artisan('nova:sync-permissions --prune')->assertSuccessful();
        $this->assertModelMissing($old);
        $this->assertModelMissing($permission);

        $this->assertSame(
            ['access_control', 'assets', 'audit', 'clients', 'projects', 'timesheets', 'users'],
            Module::query()->orderBy('code')->pluck('code')->all(),
        );
    }

    #[Test]
    public function migrar_deja_el_catalogo_al_dia_sin_comandos_extra(): void
    {
        // RefreshDatabase ya corrió las migraciones: el catálogo debe estar sincronizado.
        $this->assertSame(ModuleStatus::Active, Module::query()->where('code', 'timesheets')->firstOrFail()->status);
        $this->assertSame(ModuleStatus::Active, Module::query()->where('code', 'assets')->firstOrFail()->status);
        $this->assertTrue(Permission::query()->where('code', 'assets.view')->exists());
        $this->assertTrue(Permission::query()->where('code', 'timesheets.approve_any')->exists());
    }
}
