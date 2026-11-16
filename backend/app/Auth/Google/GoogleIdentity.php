<?php

namespace App\Auth\Google;

use App\Auth\CorporateIdentity;

/**
 * Identidad confirmada a partir de un id_token válido de Google Workspace.
 */
final class GoogleIdentity implements CorporateIdentity
{
    public function __construct(
        public readonly string $subject,      // claim "sub": inmutable por cuenta de Google
        public readonly string $hostedDomain, // claim "hd": dominio de Google Workspace
        public readonly string $email,
        public readonly string $name,
    ) {}

    public function provider(): string
    {
        return 'google';
    }

    public function subjectColumn(): string
    {
        return 'google_sub';
    }

    public function subject(): string
    {
        return $this->subject;
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
            'google_sub' => $this->subject,
            'google_hosted_domain' => $this->hostedDomain,
        ];
    }
}
