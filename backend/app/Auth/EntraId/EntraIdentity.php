<?php

namespace App\Auth\EntraId;

use App\Auth\CorporateIdentity;

/**
 * Identidad confirmada a partir de un id_token válido de Entra ID.
 */
final class EntraIdentity implements CorporateIdentity
{
    public function __construct(
        public readonly string $objectId,   // claim "oid": inmutable por usuario y tenant
        public readonly string $tenantId,   // claim "tid"
        public readonly string $email,      // claim "email" o "preferred_username" (UPN)
        public readonly string $name,
    ) {}

    public function provider(): string
    {
        return 'microsoft';
    }

    public function subjectColumn(): string
    {
        return 'microsoft_oid';
    }

    public function subject(): string
    {
        return $this->objectId;
    }

    public function email(): string
    {
        return $this->email;
    }

    public function name(): string
    {
        return $this->name;
    }

    public function linkAttributes(): array
    {
        return [
            'microsoft_oid' => $this->objectId,
            'microsoft_tenant_id' => $this->tenantId,
        ];
    }
}
