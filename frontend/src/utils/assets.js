// Formatos del módulo de activos. Las horas de las lecturas se muestran en
// hora de Colombia aunque el navegador esté en otra zona.
const ZONE = 'America/Bogota';
const time = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONE });
const dayTime = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONE });
const day = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONE });
const decimal = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

export const formatTime = (iso) => (iso ? time.format(new Date(iso)) : '—');
export const formatDayTime = (iso) => (iso ? dayTime.format(new Date(iso)).replace('.', '') : '—');
export const formatDay = (iso) => (iso ? day.format(new Date(iso)) : '—');

/** 22.5 °C, 1,2 PPM, "Abierta"… */
export function formatReading(value, unit, type) {
  if (value === null || value === undefined) return '—';
  if (type === 'STATE') return value >= 1 ? 'Asegurada' : 'Abierta';
  if (type === 'DETECTION') return value >= 1 ? 'Movimiento' : 'Sin presencia';
  return `${decimal.format(value)}${unit ? ` ${unit}` : ''}`;
}

export const formatDecimal = (value) => (typeof value === 'number' ? decimal.format(value) : '—');

const STATUS = {
  NORMAL: ['Normal', 'success'],
  ACTIVE: ['Activo', 'success'],
  ONLINE: ['En línea', 'success'],
  CLEAR: ['Sin novedad', 'success'],
  LOCKED: ['Asegurada', 'success'],
  ON: ['Encendido', 'success'],
  OFF: ['En espera', 'neutral'],
  WARNING: ['Aviso', 'warning'],
  DETECTED: ['Detectado', 'warning'],
  UNLOCKED: ['Sin asegurar', 'warning'],
  ALERT: ['Alerta', 'danger'],
  OFFLINE: ['Sin conexión', 'danger'],
};

/** Estado de una lectura en palabras y su tono de color. */
export function readingStatus(status) {
  return STATUS[status] ?? [status ?? '—', 'neutral'];
}

export const SERIES_TONES = ['primary', 'accent', 'success', 'warning', 'ink', 'danger'];
