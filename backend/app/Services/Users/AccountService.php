<?php

namespace App\Services\Users;

use App\Models\User;
use App\Services\Audit\AuditLogger;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Configuración que cada persona cambia de su propia cuenta: foto de perfil
 * y preferencias de notificación. El nombre y el correo vienen del
 * proveedor de identidad (Microsoft o Google) y se actualizan al ingresar.
 *
 * Las fotos se guardan en el disco privado (storage/app/private/avatars),
 * nunca en una carpeta pública: solo las entrega la API a quien tiene sesión.
 */
class AccountService
{
    public const DISK = 'local';

    public function __construct(private readonly AuditLogger $audit) {}

    public function updateAvatar(User $user, UploadedFile $file): User
    {
        // La extensión sale del contenido real del archivo, no del nombre.
        $extension = match ($file->getMimeType()) {
            'image/png' => 'png',
            'image/webp' => 'webp',
            default => 'jpg',
        };
        $path = $file->storeAs('avatars', $user->getKey().'-'.Str::random(20).'.'.$extension, self::DISK);
        $previous = $user->avatar_path;

        DB::transaction(function () use ($user, $path) {
            $user->forceFill(['avatar_path' => $path, 'avatar_updated_at' => now()])->save();
            $this->audit->log('account.avatar_updated', $user, $user);
        });

        if ($previous && $previous !== $path) {
            Storage::disk(self::DISK)->delete($previous);
        }

        return $user;
    }

    public function removeAvatar(User $user): User
    {
        $previous = $user->avatar_path;
        if (! $previous) {
            return $user;
        }

        DB::transaction(function () use ($user) {
            $user->forceFill(['avatar_path' => null, 'avatar_updated_at' => now()])->save();
            $this->audit->log('account.avatar_removed', $user, $user);
        });

        Storage::disk(self::DISK)->delete($previous);

        return $user;
    }

    public function updatePreferences(User $user, bool $notifyByEmail): User
    {
        if ($user->notify_by_email !== $notifyByEmail) {
            $user->forceFill(['notify_by_email' => $notifyByEmail])->save();
            $this->audit->log('account.preferences_updated', $user, $user, ['notify_by_email' => $notifyByEmail]);
        }

        return $user;
    }
}
