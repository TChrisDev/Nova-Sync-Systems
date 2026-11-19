<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\Audit\AuditLogger;
use App\Services\Authorization\PermissionCatalog;
use App\Services\Projects\ModuleSetup;
use Illuminate\Console\Command;

/**
 * Activa el módulo de Activos y monitoreo en una instalación existente:
 * sincroniza el catálogo y agrega sus permisos a las plantillas de roles
 * (Gerencia, Subgerencia, Comercial, Líder de proyecto y Consultor). No quita
 * ningún permiso que el Super Admin haya dado o retirado en otros módulos.
 */
class SetupAssetsModule extends Command
{
    protected $signature = 'nova:setup-assets';

    protected $description = 'Agrega los permisos de Activos y monitoreo a las plantillas de roles';

    public function handle(PermissionCatalog $catalog, ModuleSetup $setup, AuditLogger $audit): int
    {
        $catalog->sync();
        $updated = $setup->grantModule('assets');

        $this->info($updated ? 'Permisos de activos agregados a: '.implode(', ', $updated).'.' : 'Las plantillas ya tenían los permisos de activos.');
        $audit->log('assets.setup', null, null, ['roles' => $updated]);

        return self::SUCCESS;
    }
}
