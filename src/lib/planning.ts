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

/* ---------- Lire la semaine d'un coup d'œil (26/11/2026 : « la visibilité est catastrophique ») ---------- */

export interface Ev {
  date: string;
  debut: string;
  fin: string;
  objet: string;
  client: string;
  intervenants: string[];
}

/** Jours affichés : 5 (lun.–ven.), 6 (lun.–sam.) ou 7. Un jour masqué qui a un événement est QUAND MÊME montré. */
export function visibleDays(monday: string, count: number, events: Ev[]): string[] {
  const n = count === 5 || count === 7 ? count : 6;
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d, i) => i < n || events.some((e) => e.date === d));
}

const mins = (hhmm: string) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);

export interface Conflict {
  date: string;
  qui: string;
  a: Ev;
  b: Ev;
}

/** Deux événements à heures connues qui se chevauchent pour une MÊME personne. */
export function conflicts(events: Ev[]): Conflict[] {
  const out: Conflict[] = [];
  const timed = events.filter((e) => e.debut && e.fin);
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (a.date !== b.date) continue;
      const qui = a.intervenants.find((p) => b.intervenants.includes(p));
      if (!qui) continue;
      if (mins(a.debut)! < mins(b.fin)! && mins(b.debut)! < mins(a.fin)!) out.push({ date: a.date, qui, a, b });
    }
  return out;
}

/** Les prochains événements à partir de maintenant (jour local + heure HH:MM). */
export function upcoming<T extends Ev>(events: T[], today: string, now: string, max = 3): T[] {
  return events
    .filter((e) => e.date > today || (e.date === today && (e.fin || e.debut || '23:59') >= now))
    .sort((x, y) => (x.date + (x.debut || '00:00')).localeCompare(y.date + (y.debut || '00:00')))
    .slice(0, max);
}

/** « Aujourd'hui », « Demain », sinon « jeu. 26 nov. ». */
export function whenLabel(day: string, today: string): string {
  if (day === today) return 'Aujourd’hui';
  if (day === addDays(today, 1)) return 'Demain';
  return dayLabel(day);
}

/** Charge par personne sur la semaine (nombre d'événements), la plus chargée d'abord. */
export function load(events: Ev[]): { qui: string; n: number }[] {
  const m = new Map<string, number>();
  for (const e of events) for (const p of e.intervenants.length ? e.intervenants : ['Non affecté']) m.set(p, (m.get(p) ?? 0) + 1);
  return [...m].map(([qui, n]) => ({ qui, n })).sort((a, b) => b.n - a.n || a.qui.localeCompare(b.qui));
}

export const nowHHMM = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
