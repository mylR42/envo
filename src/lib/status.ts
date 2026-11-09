/**
 * Statuts de devis lus dans Interfast → une famille, une couleur, une place.
 *
 * ⚠️ UNE COULEUR PAR FAMILLE, JAMAIS PARTAGÉE (09/11/2026 : « Payé » avait le
 * bleu d'« Envoyé », faute d'être reconnu). Les familles suivent la vie d'un
 * devis et gardent cet ordre dans la barre : les voisins sont donc toujours les
 * mêmes, et cet ordre-là a été validé (scripts dataviz : daltonisme compris).
 * Un statut inconnu va dans « Autres », en gris : un gris ne se confond avec
 * aucune famille. Deux statuts d'une même famille (« Accepté », « Signé ») sont
 * additionnés en une seule part. PUR, testé.
 */
export type Slot = 0 | 1 | 2 | 3 | 4 | 5;

export const FAMILIES: { key: string; label: string; slot: Slot; test: RegExp }[] = [
  { key: 'brouillon', label: 'Brouillon', slot: 4, test: /brouillon|draft|à envoyer|a envoyer/i },
  { key: 'envoye', label: 'Envoyé', slot: 1, test: /envoy|attente|sent|pending|transmis/i },
  { key: 'signe', label: 'Signé', slot: 3, test: /accept|sign|valid|gagn|won/i },
  { key: 'paye', label: 'Payé', slot: 5, test: /pay|factur|r[eé]gl|encaiss|sold/i },
  { key: 'refuse', label: 'Refusé', slot: 2, test: /refus|expir|perdu|annul|lost|reject|cancel/i },
];
const OTHER = { key: 'autres', label: 'Autres', slot: 0 as Slot };

export function statusFamily(statut: string) {
  return FAMILIES.find((f) => f.test.test(statut)) ?? OTHER;
}

export interface PipeRow {
  statut: string;
  nombre: number | null;
  montant_ht: number | null;
}
export interface PipePart {
  key: string;
  label: string;
  slot: Slot;
  nombre: number | null;
  montant_ht: number;
  /** Statuts d'Interfast réunis dans la part (« Accepté, Signé »). */
  sources: string[];
}

/** Regroupe par famille, dans l'ordre de vie du devis, « Autres » à la fin. */
export function groupPipeline(rows: PipeRow[]): PipePart[] {
  const order = [...FAMILIES.map((f) => f.key), OTHER.key];
  const parts = new Map<string, PipePart>();
  for (const r of rows) {
    if (!(r.montant_ht !== null && r.montant_ht > 0) && !(r.nombre && r.nombre > 0)) continue;
    const f = statusFamily(r.statut);
    const p = parts.get(f.key) ?? { key: f.key, label: f.label, slot: f.slot, nombre: null, montant_ht: 0, sources: [] };
    p.montant_ht += r.montant_ht ?? 0;
    if (r.nombre !== null) p.nombre = (p.nombre ?? 0) + r.nombre;
    p.sources.push(r.statut);
    parts.set(f.key, p);
  }
  return [...parts.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}
