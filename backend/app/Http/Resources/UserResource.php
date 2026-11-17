<?php

namespace App\Http\Resources;

use App\Models\Role;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\User */
class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'is_active' => $this->is_active,
            // Indican si ya ingresó al menos una vez con cada proveedor (no exponen el identificador).
            'microsoft_linked' => $this->microsoft_oid !== null,
            // Un usuario recién creado no trae la columna hasta recargarse.
            'google_linked' => ($this->resource->getAttributes()['google_sub'] ?? null) !== null,
            // La versión en la URL hace que el navegador pida la foto nueva al cambiarla.
            'avatar_url' => $this->avatarUrl(),
            // Preferencias: solo en la cuenta propia.
            'notify_by_email' => $this->when(
                $request->user()?->getKey() === $this->id,
                fn () => (bool) ($this->resource->getAttributes()['notify_by_email'] ?? true),
            ),
            'is_super_admin' => $this->whenLoaded('roles', fn () => $this->roles->contains(
                fn (Role $role) => $role->isSuperAdmin() && $role->is_active
            )),
            'roles' => $this->whenLoaded('roles', fn () => $this->roles->map(fn (Role $role) => [
                'id' => $role->id,
                'name' => $role->name,
                'slug' => $role->slug,
                'is_active' => $role->is_active,
                'is_system' => $role->is_system,
            ])->values()),
            'last_login_at' => $this->last_login_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    private function avatarUrl(): ?string
    {
        $attributes = $this->resource->getAttributes();
        if (empty($attributes['avatar_path'])) {
            return null;
        }

        $version = $this->avatar_updated_at?->getTimestamp() ?? 0;

        return "/api/v1/users/{$this->id}/avatar?v={$version}";
    }
}
