<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Realtime\RealtimeTicketIssuer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RealtimeController extends Controller
{
    /**
     * Ticket de conexión para el canal en tiempo real. Es POST para que
     * Sanctum exija el token CSRF: otra página no puede pedirlo a nombre
     * del usuario.
     */
    public function ticket(Request $request, RealtimeTicketIssuer $issuer): JsonResponse
    {
        if (! $issuer->isAvailable()) {
            return response()->json([
                'message' => 'Las actualizaciones en tiempo real no están habilitadas en este servidor.',
                'code' => 'realtime_unavailable',
            ], 503);
        }

        return response()->json(['data' => $issuer->issue($request->user())])
            ->header('Cache-Control', 'no-store');
    }
}
