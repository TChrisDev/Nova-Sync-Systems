<?php

namespace App\Auth;

/**
 * Identidad corporativa confirmada por un proveedor OpenID Connect
 * (Microsoft Entra ID o Google Workspace) a partir de un id_token válido.
 *
 * Cada proveedor tiene su propia columna con el identificador inmutable de
 * la persona; el correo solo se usa para encontrar cuentas autorizadas que
 * todavía no se han vinculado.
 */
interface CorporateIdentity
{
    /** Código estable del proveedor: "microsoft" o "google". */
    public function provider(): string;

    /** Columna de users con el identificador inmutable del proveedor. */
    public function subjectColumn(): string;

    /** Identificador inmutable (oid en Entra ID, sub en Google). */
    public function subject(): string;

    public function email(): string;

    public function name(): string;

    /** Atributos que se guardan en el usuario al vincular la identidad. */
    public function linkAttributes(): array;
}
