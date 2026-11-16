// Reglas de entrega de los eventos a cada conexión del navegador.

/**
 * Un evento llega a una persona si puede seguir todo el módulo (scope del
 * ticket) o si aparece entre las personas involucradas (sus horas, los
 * proyectos que lidera, su propio perfil...).
 */
export function canReceive(event, connection) {
  if (!event || typeof event.module !== 'string') return false;
  if (connection.scopes.has(event.module)) return true;

  const userIds = event.audience?.user_ids;
  return Array.isArray(userIds) && userIds.includes(connection.uid);
}

/** Eventos sobre la propia cuenta que obligan a revisar sesión y permisos. */
const ACCESS_EVENTS = new Set(['user.deleted', 'user.roles_changed', 'role.permissions_changed']);

export function affectsAccess(event, connection) {
  const involved = Array.isArray(event.audience?.user_ids) && event.audience.user_ids.includes(connection.uid);
  if (!involved) return false;
  if (ACCESS_EVENTS.has(event.type)) return true;

  return event.type === 'user.updated' && Array.isArray(event.changed) && event.changed.includes('is_active');
}

/**
 * Lo que viaja al navegador: un aviso de cambio sin datos de negocio. Se
 * quitan la audiencia y el autor; la página vuelve a pedir el dato a la API.
 */
export function toClientEvent(event) {
  return {
    id: event.event_id,
    type: event.type,
    module: event.module,
    aggregate: event.aggregate,
    changed: Array.isArray(event.changed) ? event.changed : [],
    refs: event.refs ?? {},
    occurred_at: event.occurred_at,
  };
}
