/** Dates du planning (semaine du lundi au dimanche), en jours locaux AAAA-MM-JJ. PUR, testé. */

const pad = (n: number) => String(n).padStart(2, '0');

export const todayIso = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const at = (day: string) => new Date(`${day}T12:00:00Z`);

export function addDays(day: string, n: number): string {
  const d = at(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(day: string): string {
  return addDays(day, -((at(day).getUTCDay() + 6) % 7));
}

/** « lun. 23 nov. » */
export const dayLabel = (day: string) => {
  const t = at(day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** « Semaine du 23 au 29 nov. 2026 », « Semaine du 30 nov. au 6 déc. 2026 » */
export function weekLabel(monday: string): string {
  const a = at(monday);
  const b = at(addDays(monday, 6));
  const month = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
  const left = a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}` : `${a.getUTCDate()} ${month(a)}`;
  return `Semaine du ${left} au ${b.getUTCDate()} ${month(b)} ${b.getUTCFullYear()}`;
}
