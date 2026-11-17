<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Notifications\DatabaseNotification;

/**
 * Notificaciones de la campana. Cada persona solo ve y marca las suyas: las
 * consultas parten siempre de $request->user()->notifications().
 */
class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'unread' => ['sometimes', 'boolean'],
            'per_page' => ['sometimes', 'integer', 'min:5', 'max:50'],
        ]);

        $user = $request->user();
        $page = $user->notifications()
            ->when($request->boolean('unread'), fn ($q) => $q->whereNull('read_at'))
            ->paginate($validated['per_page'] ?? 15)
            ->withQueryString();

        return response()->json([
            'data' => collect($page->items())->map(fn (DatabaseNotification $n) => $this->present($n))->values(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'unread_count' => $user->unreadNotifications()->count(),
            ],
        ]);
    }

    public function read(Request $request, string $notification): JsonResponse
    {
        $item = $request->user()->notifications()->whereKey($notification)->firstOrFail();
        $item->markAsRead();

        return response()->json(['data' => $this->present($item)]);
    }

    public function readAll(Request $request): JsonResponse
    {
        $count = $request->user()->unreadNotifications()->update(['read_at' => now()]);

        return response()->json(['message' => $count ? 'Notificaciones marcadas como leídas.' : 'No tenías notificaciones sin leer.', 'data' => ['count' => $count]]);
    }

    private function present(DatabaseNotification $notification): array
    {
        $data = $notification->data;

        return [
            'id' => $notification->id,
            'kind' => $data['kind'] ?? 'general',
            'title' => $data['title'] ?? 'Notificación',
            'body' => $data['body'] ?? null,
            // Solo rutas internas del panel: nunca un enlace externo guardado en los datos.
            'url' => is_string($data['url'] ?? null) && str_starts_with($data['url'], '/app/') ? $data['url'] : null,
            'read_at' => $notification->read_at?->toIso8601String(),
            'created_at' => $notification->created_at?->toIso8601String(),
        ];
    }
}
