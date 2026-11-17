<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Notificaciones dentro de la aplicación (canal "database" de Laravel) y
 * registro de los avisos de vencimiento ya enviados, para no repetirlos.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('type');
            $table->morphs('notifiable');
            $table->text('data');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            // La campana pide "las mías, las más recientes" y cuenta las no leídas.
            $table->index(['notifiable_type', 'notifiable_id', 'read_at']);
        });

        // Un aviso por proyecto, fecha de fin y umbral (15, 7, 1 o 0 días).
        // Si cambian la fecha de fin, los avisos vuelven a empezar.
        Schema::create('project_deadline_alerts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->date('end_date');
            $table->unsignedSmallInteger('threshold_days');
            $table->unsignedInteger('recipients')->default(0);
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['project_id', 'end_date', 'threshold_days']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('project_deadline_alerts');
        Schema::dropIfExists('notifications');
    }
};
