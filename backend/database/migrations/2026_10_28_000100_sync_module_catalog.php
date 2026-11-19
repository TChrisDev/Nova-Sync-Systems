<?php

declare(strict_types=1);

use App\Services\Authorization\PermissionCatalog;
use App\Services\Projects\ModuleSetup;
use Illuminate\Database\Migrations\Migration;

/**
 * Deja el catálogo de módulos al día con config/nova.php al migrar.
 *
 * Antes había que recordar `nova:sync-permissions` y `nova:setup-assets`
 * después de actualizar; si se olvidaban, Registro de horas seguía "En
 * desarrollo" y Activos y monitoreo respondía 403 incluso al Super Admin.
 * La sincronización es idempotente y no quita permisos que el Super Admin
 * haya ajustado: solo agrega a las plantillas de rol los de Activos.
 */
return new class extends Migration
{
    public function up(): void
    {
        app(PermissionCatalog::class)->sync();
        app(ModuleSetup::class)->grantModule('assets');
    }

    public function down(): void
    {
        // Nada que deshacer: el catálogo vuelve a sincronizarse con el comando.
    }
};
