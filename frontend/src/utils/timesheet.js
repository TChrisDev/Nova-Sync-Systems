// Utilidades de fechas y duraciones del registro de horas. Las fechas se
// manejan como texto AAAA-MM-DD y se calculan en UTC para que ningún cambio
// de zona horaria mueva un día (ver formatCalendarDate en format.js).

const weekdayShort = new Intl.DateTimeFormat('es-CO', { weekday: 'short', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDayMonth = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function toUtc(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date, days) {
  const next = toUtc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Lunes de la semana de la fecha (las semanas van de lunes a domingo). */
export function mondayOf(date) {
  const day = toUtc(date).getUTCDay(); // 0 = domingo
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const clean = (text) => text.replace('.', '');
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Lun 19" */
export function dayLabel(date) {
  return `${capitalize(clean(weekdayShort.format(toUtc(date))))} ${toUtc(date).getUTCDate()}`;
}

/** "19 oct" */
export function shortDate(date) {
  return clean(dayMonth.format(toUtc(date))).replace(' de ', ' ');
}

/** "Semana del 19 al 25 de octubre" (o "del 28 de septiembre al 4 de octubre") */
export function weekTitle(monday) {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  const start = sameMonth ? String(toUtc(monday).getUTCDate()) : longDayMonth.format(toUtc(monday));
  return `Semana del ${start} al ${longDayMonth.format(toUtc(sunday))}`;
}

/** 255 → "4:15" (reloj de horas y minutos, como se registra) */
export function formatClock(minutes) {
  const total = Math.max(0, Math.round(minutes ?? 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Lo que escribe la persona a minutos: "4:15", "4.25", "4,5", "4" o "90m".
 * Devuelve null si no se entiende.
 */
export function parseDuration(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (!value) return null;

  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);

  const onlyMinutes = /^(\d{1,4})\s*m(in)?$/.exec(value);
  if (onlyMinutes) return Number(onlyMinutes[1]);

  const hours = /^(\d{1,2})([.,]\d{1,2})?\s*h?$/.exec(value);
  if (hours) return Math.round(Number(`${hours[1]}${(hours[2] ?? '').replace(',', '.')}`) * 60);

  return null;
}

export const STATUS_TONES = {
  approved: 'success',
  submitted: 'primary',
  rejected: 'danger',
  draft: 'neutral',
};

export const STATUS_LABELS = {
  approved: 'Aprobado',
  submitted: 'Enviado',
  rejected: 'Rechazado',
  draft: 'Borrador',
};
