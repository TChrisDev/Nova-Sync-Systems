<?php

namespace App\Http\Controllers\Api\V1;

use App\Auth\EntraId\EntraIdConfig;
use App\Auth\Google\GoogleConfig;
use App\Http\Controllers\Controller;
use App\Services\Audit\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;

class SessionController extends Controller
{
    /**
     * Estado público de la configuración de acceso (sin revelar valores).
     * "configured" indica si hay al menos un proveedor listo.
     */
    public function config(EntraIdConfig $microsoft, GoogleConfig $google): JsonResponse
    {
        $providers = [
            [
                'id' => 'microsoft',
                'name' => 'Microsoft 365',
                'configured' => $microsoft->isConfigured(),
                'login_url' => '/auth/microsoft/redirect',
            ],
            [
                'id' => 'google',
                'name' => 'Google Workspace',
                'configured' => $google->isConfigured(),
                'login_url' => '/auth/google/redirect',
            ],
        ];

        return response()->json(['data' => [
            'configured' => collect($providers)->contains('configured', true),
            'providers' => $providers,
        ]]);
    }

    public function logout(Request $request, AuditLogger $audit): Response
    {
        if ($user = $request->user()) {
            $audit->log('auth.logout', $user, $user);
        }

        Auth::guard('web')->logout();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->noContent();
    }
}
