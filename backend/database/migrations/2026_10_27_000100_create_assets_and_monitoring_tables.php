<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Activos y monitoreo: equipos de cada cliente, cómo se conectan, lo que
 * reportan sus sensores, las reglas que convierten lecturas en alertas y los
 * incidentes que se atienden (con horas registradas contra el contrato).
 *
 * - external_ref guarda el identificador del archivo de origen ("inv:2",
 *   "iot:IOT-OF1-02") para que volver a importar actualice en lugar de duplicar.
 * - Las lecturas se guardan tal cual llegan; las alertas apuntan a la lectura
 *   que las disparó, así siempre se puede explicar por qué existe una alerta.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained()->restrictOnDelete();
            $table->string('external_ref', 60)->nullable();
            $table->string('name', 120);
            $table->string('category', 30)->index();
            $table->string('model', 80)->nullable();
            $table->string('serial', 80)->nullable();
            $table->string('role', 80)->nullable();
            $table->string('criticality', 10)->index();
            $table->string('location', 120)->nullable();
            $table->string('vlan', 40)->nullable();
            $table->json('ip_addresses')->nullable();
            $table->json('mac_addresses')->nullable();
            $table->string('gateway', 45)->nullable();
            $table->json('monitoring')->nullable();          // syslog, snmp, ntp, ssh, netflow
            $table->string('reading_type', 20)->nullable();  // sensores: TEMP, HUMIDITY, SMOKE...
            $table->string('reading_unit', 10)->nullable();
            $table->string('iot_server', 45)->nullable();
            $table->string('last_status', 20)->nullable();
            $table->decimal('last_value', 12, 3)->nullable();
            $table->timestamp('last_reading_at')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'external_ref']);
            $table->index(['client_id', 'is_active']);
        });

        Schema::create('asset_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained()->restrictOnDelete();
            $table->string('external_ref', 60)->nullable();
            $table->foreignId('source_asset_id')->constrained('assets')->cascadeOnDelete();
            $table->string('source_port', 60)->nullable();
            $table->foreignId('target_asset_id')->constrained('assets')->cascadeOnDelete();
            $table->string('target_port', 60)->nullable();
            $table->string('link_type', 40)->nullable();
            $table->string('cable_type', 40)->nullable();
            $table->boolean('is_functional')->nullable();
            $table->string('criticality', 10)->nullable();
            $table->timestamps();

            $table->unique(['client_id', 'external_ref']);
        });

        Schema::create('telemetry_readings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->timestamp('recorded_at');
            $table->string('status', 20);
            $table->decimal('value', 12, 3)->nullable();
            $table->string('unit', 10)->nullable();
            $table->string('note', 200)->nullable();
            $table->timestamps();

            $table->unique(['asset_id', 'recorded_at']);
            $table->index('recorded_at');
        });

        Schema::create('alert_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained()->cascadeOnDelete(); // vacío = todos los clientes
            $table->string('name', 100);
            $table->string('reading_type', 20);
            $table->string('operator', 5);
            $table->decimal('threshold', 12, 3);
            $table->string('severity', 10);
            $table->boolean('opens_incident')->default(false);
            $table->boolean('is_active')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('incidents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained()->restrictOnDelete();
            $table->foreignId('project_id')->nullable()->constrained()->nullOnDelete();
            $table->string('code', 30)->unique();
            $table->string('title', 150);
            $table->string('severity', 10);
            $table->string('status', 20)->index();
            $table->timestamp('opened_at');
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->string('description', 2000)->nullable();
            $table->string('resolution', 2000)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['client_id', 'status']);
        });

        Schema::create('alerts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained()->cascadeOnDelete();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->foreignId('alert_rule_id')->constrained()->cascadeOnDelete();
            $table->foreignId('telemetry_reading_id')->constrained()->cascadeOnDelete();
            $table->foreignId('incident_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('triggered_at');
            $table->decimal('value', 12, 3)->nullable();
            $table->string('severity', 10);
            $table->timestamps();

            $table->unique(['alert_rule_id', 'telemetry_reading_id']);
            $table->index(['client_id', 'triggered_at']);
        });

        Schema::table('time_entries', function (Blueprint $table) {
            $table->foreignId('incident_id')->nullable()->after('project_id')->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('time_entries', function (Blueprint $table) {
            $table->dropConstrainedForeignId('incident_id');
        });
        Schema::dropIfExists('alerts');
        Schema::dropIfExists('incidents');
        Schema::dropIfExists('alert_rules');
        Schema::dropIfExists('telemetry_readings');
        Schema::dropIfExists('asset_links');
        Schema::dropIfExists('assets');
    }
};
