<?php

use App\Http\Controllers\Api\V1\AccountController;
use App\Http\Controllers\Api\V1\AssetController;
use App\Http\Controllers\Api\V1\AuditLogController;
use App\Http\Controllers\Api\V1\CapacityController;
use App\Http\Controllers\Api\V1\ClientContactController;
use App\Http\Controllers\Api\V1\ClientController;
use App\Http\Controllers\Api\V1\ContractController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\ModuleController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Http\Controllers\Api\V1\MonitoringController;
use App\Http\Controllers\Api\V1\PermissionController;
use App\Http\Controllers\Api\V1\ProjectController;
use App\Http\Controllers\Api\V1\RealtimeController;
use App\Http\Controllers\Api\V1\ReferenceDataController;
use App\Http\Controllers\Api\V1\RoleController;
use App\Http\Controllers\Api\V1\SessionController;
use App\Http\Controllers\Api\V1\StaffController;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Controllers\Api\V1\UserController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API v1 — Nova Sync Systems
|--------------------------------------------------------------------------
| Autenticación: cookie de sesión (Sanctum SPA) emitida tras el inicio de
| sesión con Microsoft 365. Todas las operaciones protegidas se autorizan
| en el servidor mediante policies, middleware y reglas de negocio.
*/

Route::prefix('v1')->name('api.v1.')->group(function () {
    Route::get('auth/config', [SessionController::class, 'config'])->name('auth.config');

    Route::middleware(['auth:sanctum', 'active', 'throttle:api'])->group(function () {
        Route::post('auth/logout', [SessionController::class, 'logout'])->name('auth.logout');
        Route::get('me', MeController::class)->name('me');
        Route::get('dashboard', DashboardController::class)->name('dashboard');
        Route::get('modules', [ModuleController::class, 'index'])->name('modules.index');
        Route::post('realtime/ticket', [RealtimeController::class, 'ticket'])->name('realtime.ticket');

        // Notificaciones de la campana (siempre las de la propia cuenta).
        Route::get('notifications', [NotificationController::class, 'index'])->name('notifications.index');
        Route::post('notifications/read-all', [NotificationController::class, 'readAll'])->name('notifications.read-all');
        Route::post('notifications/{notification}/read', [NotificationController::class, 'read'])->whereUuid('notification')->name('notifications.read');

        // Configuración de la propia cuenta.
        Route::put('account/preferences', [AccountController::class, 'updatePreferences'])->name('account.preferences');
        Route::post('account/avatar', [AccountController::class, 'updateAvatar'])->middleware('throttle:10,1')->name('account.avatar');
        Route::delete('account/avatar', [AccountController::class, 'destroyAvatar'])->name('account.avatar.destroy');
        Route::get('users/{user}/avatar', [AccountController::class, 'avatar'])->whereNumber('user')->name('users.avatar');

        // Roles y permisos
        Route::get('permissions', [PermissionController::class, 'index'])
            ->middleware('permission:access_control.view')
            ->name('permissions.index');
        Route::get('roles', [RoleController::class, 'index'])->name('roles.index');
        Route::post('roles', [RoleController::class, 'store'])->name('roles.store');
        Route::get('roles/{role}', [RoleController::class, 'show'])->name('roles.show');
        Route::put('roles/{role}', [RoleController::class, 'update'])->name('roles.update');
        Route::patch('roles/{role}/status', [RoleController::class, 'updateStatus'])->name('roles.status');
        Route::put('roles/{role}/permissions', [RoleController::class, 'syncPermissions'])->name('roles.permissions');

        // Usuarios
        Route::get('users', [UserController::class, 'index'])->name('users.index');
        Route::post('users', [UserController::class, 'store'])->name('users.store');
        Route::get('users/{user}', [UserController::class, 'show'])->name('users.show');
        Route::patch('users/{user}/status', [UserController::class, 'updateStatus'])->name('users.status');
        Route::put('users/{user}/roles', [UserController::class, 'syncRoles'])->name('users.roles');
        Route::delete('users/{user}', [UserController::class, 'destroy'])->name('users.destroy');

        // Auditoría
        Route::get('audit-logs', [AuditLogController::class, 'index'])
            ->middleware('permission:audit.view')
            ->name('audit-logs.index');

        // Proyectos y capacidad. La autorización vive en las policies y en los
        // Form Requests de cada operación; aquí solo se declaran las rutas.
        Route::get('reference-data', ReferenceDataController::class)->name('reference-data');

        Route::get('clients', [ClientController::class, 'index'])->name('clients.index');
        Route::post('clients', [ClientController::class, 'store'])->name('clients.store');
        Route::get('clients/{client}', [ClientController::class, 'show'])->name('clients.show');
        Route::put('clients/{client}', [ClientController::class, 'update'])->name('clients.update');
        Route::delete('clients/{client}', [ClientController::class, 'destroy'])->name('clients.destroy');
        Route::scopeBindings()->group(function () {
            Route::get('clients/{client}/contacts', [ClientContactController::class, 'index'])->name('clients.contacts.index');
            Route::post('clients/{client}/contacts', [ClientContactController::class, 'store'])->name('clients.contacts.store');
            Route::put('clients/{client}/contacts/{contact}', [ClientContactController::class, 'update'])->name('clients.contacts.update');
            Route::delete('clients/{client}/contacts/{contact}', [ClientContactController::class, 'destroy'])->name('clients.contacts.destroy');
        });

        Route::get('contracts', [ContractController::class, 'index'])->name('contracts.index');
        Route::get('contracts/overview', [ContractController::class, 'overview'])->name('contracts.overview');
        Route::get('contracts/export', [ContractController::class, 'export'])->name('contracts.export');
        Route::post('contracts', [ContractController::class, 'store'])->name('contracts.store');
        Route::get('contracts/{contract}', [ContractController::class, 'show'])->whereNumber('contract')->name('contracts.show');
        Route::put('contracts/{contract}', [ContractController::class, 'update'])->name('contracts.update');
        Route::delete('contracts/{contract}', [ContractController::class, 'destroy'])->name('contracts.destroy');
        Route::patch('contracts/{contract}/status', [ContractController::class, 'updateStatus'])->name('contracts.status');
        Route::get('contracts/{contract}/history', [ContractController::class, 'history'])->name('contracts.history');
        Route::get('contracts/{contract}/hour-movements', [ContractController::class, 'movements'])->name('contracts.movements');
        Route::post('contracts/{contract}/hour-movements', [ContractController::class, 'addHours'])->name('contracts.add-hours');
        Route::get('contracts/{contract}/consumption', [ContractController::class, 'consumption'])->name('contracts.consumption');

        Route::get('projects', [ProjectController::class, 'index'])->name('projects.index');
        Route::post('projects', [ProjectController::class, 'store'])->name('projects.store');
        Route::get('projects/overview', [ProjectController::class, 'overview'])->name('projects.overview');
        Route::get('projects/leaders', [ProjectController::class, 'leaders'])->name('projects.leaders');
        Route::get('projects/{project}', [ProjectController::class, 'show'])->whereNumber('project')->name('projects.show');
        Route::put('projects/{project}', [ProjectController::class, 'update'])->name('projects.update');
        Route::delete('projects/{project}', [ProjectController::class, 'destroy'])->name('projects.destroy');
        Route::patch('projects/{project}/status', [ProjectController::class, 'updateStatus'])->name('projects.status');
        Route::patch('projects/{project}/leader', [ProjectController::class, 'updateLeader'])->name('projects.leader');
        Route::get('projects/{project}/hours', [ProjectController::class, 'hours'])->name('projects.hours');
        Route::get('projects/{project}/allocations', [ProjectController::class, 'allocations'])->name('projects.allocations');
        Route::post('projects/{project}/allocations', [ProjectController::class, 'storeAllocation'])->name('projects.allocations.store');
        Route::scopeBindings()->group(function () {
            Route::patch('projects/{project}/allocations/{allocation}', [ProjectController::class, 'updateAllocation'])->name('projects.allocations.update');
            Route::post('projects/{project}/allocations/{allocation}/end', [ProjectController::class, 'endAllocation'])->name('projects.allocations.end');
            Route::delete('projects/{project}/allocations/{allocation}', [ProjectController::class, 'destroyAllocation'])->name('projects.allocations.destroy');
        });

        Route::get('capacity', [CapacityController::class, 'index'])->name('capacity.index');
        Route::get('capacity/available', [CapacityController::class, 'available'])->name('capacity.available');
        Route::get('staff', [StaffController::class, 'index'])->name('staff.index');
        Route::put('staff/{user}', [StaffController::class, 'update'])->name('staff.update');

        // Activos y monitoreo: todo exige assets.view; cada escritura revisa su permiso.
        Route::middleware('permission:assets.view')->group(function () {
            Route::get('assets/clients', [AssetController::class, 'clients'])->name('assets.clients');
            Route::get('assets/dashboard', [AssetController::class, 'dashboard'])->name('assets.dashboard');
            Route::get('assets/map', [AssetController::class, 'map'])->name('assets.map');
            Route::get('assets/coverage', [AssetController::class, 'coverage'])->name('assets.coverage');
            Route::post('assets/import', [AssetController::class, 'import'])->middleware('throttle:20,1')->name('assets.import');
            Route::get('assets', [AssetController::class, 'index'])->name('assets.index');
            Route::post('assets', [AssetController::class, 'store'])->name('assets.store');
            Route::get('assets/{asset}', [AssetController::class, 'show'])->whereNumber('asset')->name('assets.show');
            Route::put('assets/{asset}', [AssetController::class, 'update'])->whereNumber('asset')->name('assets.update');
            Route::delete('assets/{asset}', [AssetController::class, 'destroy'])->whereNumber('asset')->name('assets.destroy');

            Route::get('telemetry/sensors', [MonitoringController::class, 'sensors'])->name('telemetry.sensors');
            Route::get('telemetry/series', [MonitoringController::class, 'series'])->name('telemetry.series');
            Route::get('alerts', [MonitoringController::class, 'alerts'])->name('alerts.index');
            Route::get('alert-rules', [MonitoringController::class, 'rules'])->name('alert-rules.index');
            Route::post('alert-rules', [MonitoringController::class, 'storeRule'])->name('alert-rules.store');
            Route::post('alert-rules/evaluate', [MonitoringController::class, 'evaluate'])->name('alert-rules.evaluate');
            Route::put('alert-rules/{rule}', [MonitoringController::class, 'updateRule'])->whereNumber('rule')->name('alert-rules.update');
            Route::delete('alert-rules/{rule}', [MonitoringController::class, 'destroyRule'])->whereNumber('rule')->name('alert-rules.destroy');

            Route::get('incidents', [MonitoringController::class, 'incidents'])->name('incidents.index');
            Route::post('incidents', [MonitoringController::class, 'storeIncident'])->name('incidents.store');
            Route::get('incidents/{incident}', [MonitoringController::class, 'incident'])->whereNumber('incident')->name('incidents.show');
            Route::patch('incidents/{incident}', [MonitoringController::class, 'updateIncident'])->whereNumber('incident')->name('incidents.update');
        });

        Route::get('time-entries', [TimeEntryController::class, 'index'])->name('time-entries.index');
        Route::get('time-entries/summary', [TimeEntryController::class, 'summary'])->name('time-entries.summary');
        Route::get('time-entries/projects', [TimeEntryController::class, 'projects'])->name('time-entries.projects');
        Route::get('time-entries/report', [TimeEntryController::class, 'report'])->name('time-entries.report');
        Route::get('time-entries/review-queue', [TimeEntryController::class, 'reviewQueue'])->name('time-entries.review-queue');
        Route::get('time-entries/export', [TimeEntryController::class, 'export'])->middleware('throttle:10,1')->name('time-entries.export');
        Route::post('time-entries', [TimeEntryController::class, 'store'])->name('time-entries.store');
        Route::post('time-entries/submit', [TimeEntryController::class, 'submit'])->name('time-entries.submit');
        Route::post('time-entries/approve', [TimeEntryController::class, 'approve'])->name('time-entries.approve');
        Route::post('time-entries/reject', [TimeEntryController::class, 'reject'])->name('time-entries.reject');
        Route::put('time-entries/{timeEntry}', [TimeEntryController::class, 'update'])->whereNumber('timeEntry')->name('time-entries.update');
        Route::delete('time-entries/{timeEntry}', [TimeEntryController::class, 'destroy'])->whereNumber('timeEntry')->name('time-entries.destroy');
    });
});
