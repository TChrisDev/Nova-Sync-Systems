<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Configuración de la cuenta: foto de perfil (archivo privado, servido por
 * la API solo a usuarios con sesión) y preferencia de avisos por correo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('avatar_path')->nullable()->after('google_hosted_domain');
            $table->timestamp('avatar_updated_at')->nullable()->after('avatar_path');
            $table->boolean('notify_by_email')->default(true)->after('avatar_updated_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['avatar_path', 'avatar_updated_at', 'notify_by_email']);
        });
    }
};
