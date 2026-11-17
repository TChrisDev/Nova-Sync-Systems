// Utilidades del registro de horas. Las fechas son de calendario
// ("AAAA-MM-DD") y se calculan en UTC para no depender de la zona horaria
// del navegador.

export const STEP_MINUTES = 15;
export const MAX_BACKDATE_DAYS = 31;

export const ENTRY_STATUS = {
  draft: { label: 'Borrador', tone: 'neutral' },
  submitted: { label: 'Enviada', tone: 'warning' },
  approved: { label: 'Aprobada', tone: 'success' },
  rejected: { label: 'Rechazada', tone: 'danger' },
};

// Si una celda tiene varios registros, manda el estado que más pide atención.
const PRIORITY = ['rejected', 'draft', 'submitted', 'approved'];

export function cellStatus(entries) {
  return PRIORITY.find((status) => entries.some((e) => e.status === status)) ?? null;
}

function toDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(value, days) {
  const date = toDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Lunes de la semana de la fecha (las semanas van de lunes a domingo). */
export function mondayOf(value) {
  const weekday = (toDate(value).getUTCDay() + 6) % 7; // 0 = lunes
  return addDays(value, -weekday);
}

const weekdayFormat = new Intl.DateTimeFormat('es-CO', { weekday: 'short', timeZone: 'UTC' });
const dayMonthFormat = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longFormat = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export function weekdayLabel(value) {
  const text = weekdayFormat.format(toDate(value)).replace('.', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function dayNumber(value) {
  return toDate(value).getUTCDate();
}

export function weekRangeLabel(start) {
  const end = addDays(start, 6);
  return `${dayMonthFormat.format(toDate(start))} – ${dayMonthFormat.format(toDate(end))} ${end.slice(0, 4)}`;
}

export function longDateLabel(value) {
  const text = longFormat.format(toDate(value));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Primer y último día del mes "AAAA-MM". */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** ¿Se pueden registrar horas en esa fecha? (no futuras, máximo 31 días atrás) */
export function isLoggable(value, today) {
  return value <= today && value >= addDays(today, -MAX_BACKDATE_DAYS);
}

export function sumMinutes(entries) {
  return entries.reduce((total, entry) => total + entry.minutes, 0);
}
