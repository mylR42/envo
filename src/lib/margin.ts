/**
 * La marge sur le CA (0.8.0) : chaque colonne de CA est coupée en « marge » et
 * « coûts », le total reste le CA. Un mois dont Interfast ne donne pas les
 * coûts reste une colonne grise « marge inconnue » : jamais de marge devinée.
 * PUR, testé.
 */
export interface CaMonth {
  mois: string;
  montant_ht: number | null;
  marge_ht?: number | null;
}

export interface MarginSplit {
  marge: number | null;
  couts: number | null;
  /** CA d'un mois sans marge connue. */
  inconnu: number | null;
  /** Taux de marge du mois, en %. */
  taux: number | null;
}

export function splitMargin(m: CaMonth): MarginSplit {
  const ca = m.montant_ht;
  const mg = m.marge_ht ?? null;
  if (ca === null) return { marge: null, couts: null, inconnu: null, taux: null };
  if (mg === null || mg > ca) return { marge: null, couts: null, inconnu: ca, taux: null };
  return { marge: mg, couts: ca - mg, inconnu: null, taux: ca > 0 ? (mg / ca) * 100 : null };
}

/** Taux de marge sur la période : seuls les mois où CA ET marge sont connus comptent. */
export function periodRate(months: CaMonth[]): number | null {
  let ca = 0;
  let mg = 0;
  for (const m of months) {
    if (m.montant_ht === null || m.marge_ht === null || m.marge_ht === undefined || m.marge_ht > m.montant_ht) continue;
    ca += m.montant_ht;
    mg += m.marge_ht;
  }
  return ca > 0 ? (mg / ca) * 100 : null;
}

export const pct = (v: number | null) => (v === null ? '–' : `${v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %`);
