// Verificación de los tickets que emite Laravel (RealtimeTicketIssuer):
//   v1.<claims en base64url>.<HMAC-SHA256 en base64url>
// claims: { uid, scopes, iat, exp, sx }

import { createHmac, timingSafeEqual } from 'node:crypto';

export class TicketError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function signTicket(claims, secret) {
  const body = `v1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/**
 * Devuelve los claims si el ticket es auténtico y vigente; si no, lanza
 * TicketError. `nowSeconds` permite probar la vigencia.
 */
export function verifyTicket(ticket, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || secret.length < 32) {
    throw new TicketError('not_configured', 'NOVA_REALTIME_SECRET no está configurado.');
  }
  if (typeof ticket !== 'string' || ticket.length > 4096) {
    throw new TicketError('invalid_ticket', 'Ticket ausente o demasiado largo.');
  }

  const parts = ticket.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new TicketError('invalid_ticket', 'Formato de ticket no reconocido.');
  }

  const [version, body, signature] = parts;
  const expected = createHmac('sha256', secret).update(`${version}.${body}`).digest();
  const given = Buffer.from(signature, 'base64url');

  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new TicketError('invalid_ticket', 'Firma inválida.');
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new TicketError('invalid_ticket', 'Contenido ilegible.');
  }

  if (!Number.isInteger(claims.uid) || claims.uid <= 0 || !Array.isArray(claims.scopes)) {
    throw new TicketError('invalid_ticket', 'Faltan datos en el ticket.');
  }
  if (!Number.isInteger(claims.exp) || claims.exp < nowSeconds) {
    throw new TicketError('expired_ticket', 'El ticket expiró.');
  }
  if (!Number.isInteger(claims.sx) || claims.sx <= nowSeconds) {
    throw new TicketError('expired_ticket', 'La vida máxima de la conexión ya pasó.');
  }

  return { uid: claims.uid, scopes: new Set(claims.scopes.map(String)), exp: claims.exp, sx: claims.sx };
}
