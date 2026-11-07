/** Montants et totaux d'un brouillon de devis. PUR, testé. */
import type { DraftLine } from './api';

export const euros = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export interface Totals {
  ht: number;
  tva: number;
  ttc: number;
  /** TVA ventilée par taux (10 %, 20 %…), dans l'ordre croissant. */
  byRate: { rate: number; base: number; tva: number }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function totals(lines: DraftLine[], defaultVat: number | null = null): Totals {
  const rates = new Map<number, number>();
  let ht = 0;
  for (const l of lines) {
    const q = Number(l.quantite);
    const p = Number(l.prix_unitaire_ht);
    if (!Number.isFinite(q) || !Number.isFinite(p)) continue;
    const amount = q * p;
    ht += amount;
    const rate = Number.isFinite(Number(l.tva)) && l.tva !== undefined ? Number(l.tva) : (defaultVat ?? 0);
    rates.set(rate, (rates.get(rate) ?? 0) + amount);
  }
  const byRate = [...rates.entries()].sort((a, b) => a[0] - b[0]).map(([rate, base]) => ({ rate, base: r2(base), tva: r2((base * rate) / 100) }));
  const tva = r2(byRate.reduce((s, x) => s + x.tva, 0));
  return { ht: r2(ht), tva, ttc: r2(ht + tva), byRate };
}

export const relDate = (iso: string, now = new Date()) => {
  const d = new Date(iso);
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return `aujourd’hui ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

export const STATUS_LABEL: Record<string, string> = {
  en_cours: 'En cours',
  devis_cree: 'Devis créé',
  termine: 'Terminée',
};

/** Nom d'outil Interfast lisible : « create_quote » → « Create quote ». */
export const toolLabel = (name: string) => {
  const s = name.replace(/[_.-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
