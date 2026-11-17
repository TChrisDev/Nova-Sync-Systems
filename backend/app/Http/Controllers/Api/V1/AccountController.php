<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\Users\AccountService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Configuración de la propia cuenta. Ninguna ruta recibe el id de otra
 * persona para escribir: siempre se trabaja sobre $request->user().
 */
class AccountController extends Controller
{
    public function __construct(private readonly AccountService $account) {}

    public function updatePreferences(Request $request): UserResource
    {
        $data = $request->validate(['notify_by_email' => ['required', 'boolean']]);

        $user = $this->account->updatePreferences($request->user(), (bool) $data['notify_by_email']);

        return (new UserResource($user->load('roles')))->additional(['message' => 'Preferencias guardadas.']);
    }

    public function updateAvatar(Request $request): UserResource
    {
        $min = (int) config('nova.account.avatar_min_px', 64);
        $max = (int) config('nova.account.avatar_max_px', 4096);

        $request->validate([
            'avatar' => [
                'required',
                'file',
                // Solo mapas de bits: un SVG puede llevar scripts.
                'mimes:jpg,jpeg,png,webp',
                'mimetypes:image/jpeg,image/png,image/webp',
                'max:'.(int) config('nova.account.avatar_max_kb', 2048),
                Rule::dimensions()->minWidth($min)->minHeight($min)->maxWidth($max)->maxHeight($max),
            ],
        ], [
            'avatar.mimes' => 'La foto debe ser JPG, PNG o WebP.',
            'avatar.mimetypes' => 'La foto debe ser JPG, PNG o WebP.',
            'avatar.max' => 'La foto no puede pesar más de :max KB.',
            'avatar.dimensions' => "La foto debe medir entre {$min} y {$max} píxeles por lado.",
        ]);

        $user = $this->account->updateAvatar($request->user(), $request->file('avatar'));

        return (new UserResource($user->load('roles')))->additional(['message' => 'Foto de perfil actualizada.']);
    }

    public function destroyAvatar(Request $request): UserResource
    {
        $user = $this->account->removeAvatar($request->user());

        return (new UserResource($user->load('roles')))->additional(['message' => 'Foto de perfil eliminada.']);
    }

    /** Foto de cualquier persona del ERP, solo para usuarios con sesión. */
    public function avatar(User $user): StreamedResponse
    {
        abort_unless($user->avatar_path && Storage::disk(AccountService::DISK)->exists($user->avatar_path), 404);

        return Storage::disk(AccountService::DISK)->response($user->avatar_path, null, [
            'Cache-Control' => 'private, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'",
        ]);
    }
}
