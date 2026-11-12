/** Montants et totaux d'un brouillon de devis. PUR, testé. */
/** Une ligne de brouillon de devis (partagé avec le serveur : ce fichier ne dépend pas du navigateur). */
export interface DraftLine {
  designation: string;
  quantite: number;
  unite?: string;
  prix_unitaire_ht: number;
  tva?: number;
  origine?: string;
}

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

/*
 * Les noms d'outils et de champs viennent d'Interfast, souvent en anglais
 * technique (create_quote, unit_price). L'artisan doit lire du français :
 * libellés connus d'abord, sinon traduction mot à mot, sinon le mot tel quel.
 * Rien ici ne suppose un nom d'outil précis. PUR, testé.
 */
const FIELDS: Record<string, string> = {
  lines: 'Lignes', items: 'Lignes', rows: 'Lignes', lignes: 'Lignes',
  label: 'Désignation', name: 'Nom', designation: 'Désignation', description: 'Description', title: 'Titre', titre: 'Titre',
  qty: 'Qté', quantity: 'Qté', quantite: 'Qté', unit: 'Unité', unite: 'Unité',
  unit_price: 'PU HT', price: 'Prix', unit_price_ht: 'PU HT', prix_unitaire_ht: 'PU HT', price_ht: 'Prix HT',
  vat: 'TVA %', vat_rate: 'TVA %', tax_rate: 'TVA %', tva: 'TVA %',
  discount: 'Remise', total: 'Total', total_ht: 'Total HT', total_ttc: 'Total TTC',
  customer_id: 'Client', client_id: 'Client', customer: 'Client', client: 'Client',
  address: 'Adresse', site_address: 'Adresse du chantier', email: 'E-mail', phone: 'Téléphone',
  date: 'Date', due_date: 'Échéance', validity: 'Validité', validity_days: 'Validité (jours)',
  notes: 'Remarques', note: 'Remarque', comment: 'Commentaire', status: 'Statut', reference: 'Référence', ref: 'Référence',
  query: 'Recherche', id: 'Identifiant',
};
const VERBS: Record<string, string> = {
  create: 'Créer', add: 'Ajouter', new: 'Créer', update: 'Modifier', edit: 'Modifier', delete: 'Supprimer', remove: 'Retirer',
  send: 'Envoyer', get: 'Lire', read: 'Lire', list: 'Lister', search: 'Chercher', find: 'Chercher', duplicate: 'Dupliquer',
  convert: 'Convertir', validate: 'Valider', cancel: 'Annuler', archive: 'Archiver',
};
const NOUNS: Record<string, string> = {
  quote: 'devis', quotes: 'devis', estimate: 'devis', estimates: 'devis', invoice: 'facture', invoices: 'factures',
  customer: 'client', customers: 'clients', client: 'client', clients: 'clients', contact: 'contact', contacts: 'contacts',
  product: 'article', products: 'articles', item: 'article', items: 'articles', article: 'article', articles: 'articles',
  line: 'ligne', lines: 'lignes', site: 'chantier', sites: 'chantiers', job: 'chantier', jobs: 'chantiers',
  intervention: 'intervention', interventions: 'interventions', project: 'chantier', projects: 'chantiers',
  by: 'par', email: 'e-mail', to: 'en', pdf: 'PDF',
};

const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[_.\s-]+/).filter(Boolean);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Nom d'un champ : « unit_price » → « PU HT ». */
export function fieldLabel(key: string): string {
  const k = key.toLowerCase();
  if (FIELDS[k]) return FIELDS[k];
  return cap(words(key).map((w) => FIELDS[w]?.toLowerCase() ?? NOUNS[w] ?? w).join(' '));
}

/** Nom d'un outil : « create_quote » → « Créer devis », « search_customers » → « Chercher clients ». */
export function toolLabel(name: string): string {
  const w = words(name);
  if (!w.length) return name;
  const [first, ...rest] = w;
  const verb = VERBS[first!];
  const tail = rest.map((x) => NOUNS[x] ?? x).join(' ');
  return verb ? `${verb}${tail ? ` ${tail}` : ''}` : cap(w.map((x) => NOUNS[x] ?? x).join(' '));
}
