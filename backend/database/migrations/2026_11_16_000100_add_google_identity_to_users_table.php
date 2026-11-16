<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Identidad de Google Workspace. Igual que con Microsoft, se vincula en el
 * primer ingreso exitoso: "sub" es el identificador inmutable de la cuenta
 * de Google y "hd" el dominio de Workspace al que pertenece.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('google_sub', 64)->nullable()->unique()->after('microsoft_tenant_id');
            $table->string('google_hosted_domain')->nullable()->after('google_sub');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['google_sub']);
            $table->dropColumn(['google_sub', 'google_hosted_domain']);
        });
    }
};
