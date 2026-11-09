/**
 * Serveur de DÉMONSTRATION : l'interface ET l'API sur un seul port, sans
 * PostgreSQL, sans clé Anthropic ni Interfast. Exclu du déploiement.
 *
 * - base en mémoire (PGlite), vidée à chaque redémarrage ;
 * - faux Interfast (3 outils : chercher un client, lister les devis, créer un devis) ;
 * - assistante SCÉNARISÉE : elle rejoue le même scénario (chauffe-eau chez
 *   M. Dupont) dans chaque séance, quoi qu'on lui dise. Pour la vraie
 *   assistante, il faut une clé Anthropic (voir README).
 *
 * Adresses :
 *   /demo        connecté d'office sur le compte « Paul Dupont », Interfast branché
 *   /demo/code   dernier code à 6 chiffres « envoyé » (pour tester l'inscription)
 *
 *   npm run build
 *   npx esbuild tools/demo-server.ts --bundle --platform=node --format=esm --packages=external --outfile=.demo/demo.mjs
 *   node .demo/demo.mjs            # http://localhost:4173/demo
 */
import { PGlite } from '@electric-sql/pglite';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { applySchema } from '../server/db';
import { mcpClient } from '../server/mcp';
import type { Llm } from '../server/agent';
import { fakeInterfast, MCP_URL, pgliteDb } from '../tests/server/helpers';

const PORT = Number(process.env.PORT ?? 4173);
const ORIGIN = `http://localhost:${PORT}`;

type Block = Record<string, unknown> & { type: string };
const SCENARIO: Block[][] = [
  [
    { type: 'text', text: 'Je regarde dans Interfast si **M. Dupont** est déjà client, et vos devis de chauffe-eau.' },
    { type: 'tool_use', id: 'tu_1', name: 'if_search_customers', input: { query: 'Dupont' } },
    { type: 'tool_use', id: 'tu_2', name: 'if_list_quotes', input: {} },
  ],
  [
    { type: 'text', text: 'J’ai trouvé **Martin Dupont** à Angers, et votre devis de mars pour un chauffe-eau à 1 450 € HT. On part sur la même base ?' },
    { type: 'tool_use', id: 'tu_3', name: 'proposer_choix', input: { question: 'Quelle capacité pour le chauffe-eau ?', options: ['150 L', '200 L', '300 L'] } },
  ],
  [
    { type: 'text', text: 'Voici le brouillon, sur la base de votre devis de mars et de votre taux horaire.' },
    {
      type: 'tool_use',
      id: 'tu_4',
      name: 'afficher_brouillon',
      input: {
        titre: 'Remplacement chauffe-eau 200 L',
        client: 'Martin Dupont',
        chantier: '12 rue des Lices, Angers',
        lignes: [
          { designation: 'Chauffe-eau électrique 200 L vertical', quantite: 1, unite: 'u', prix_unitaire_ht: 690, tva: 10, origine: 'Devis D-2026-0012' },
          { designation: 'Groupe de sécurité neuf', quantite: 1, unite: 'u', prix_unitaire_ht: 45, tva: 10, origine: 'REX' },
          { designation: 'Dépose et évacuation de l’ancien appareil', quantite: 1, unite: 'forfait', prix_unitaire_ht: 80, tva: 10 },
          { designation: 'Main d’œuvre pose et raccordement', quantite: 3.5, unite: 'h', prix_unitaire_ht: 48.5, tva: 10, origine: 'Taux horaire' },
        ],
        remarques: 'Validité 30 jours. Accès au cellier à confirmer.',
      },
    },
    {
      type: 'tool_use',
      id: 'tu_5',
      name: 'if_create_quote',
      input: {
        customer_id: 'c-42',
        title: 'Remplacement chauffe-eau 200 L',
        lines: [
          { label: 'Chauffe-eau électrique 200 L', qty: 1, unit_price: 690, vat: 10 },
          { label: 'Groupe de sécurité', qty: 1, unit_price: 45, vat: 10 },
        ],
      },
    },
  ],
  [{ type: 'tool_use', id: 'tu_6', name: 'memoriser', input: { type: 'tarif', contenu: 'Chauffe-eau 200 L posé : 690 € HT hors main d’œuvre.' } }],
  [{ type: 'text', text: 'C’est fait : le devis **D-2026-0099** est créé dans Interfast, en brouillon. Voulez-vous que je prépare l’e-mail d’envoi au client ?' }],
];

/**
 * L'étape du scénario se lit dans la conversation (nombre de réponses déjà
 * données) : chaque nouvelle séance le rejoue depuis le début. Les identifiants
 * d'outils reçoivent un suffixe aléatoire pour rester uniques en base.
 */
const OVERVIEW: Block[][] = [
  [
    { type: 'tool_use', id: 'ov_1', name: 'if_list_quotes', input: {} },
    { type: 'tool_use', id: 'ov_2', name: 'if_search_customers', input: { query: '' } },
  ],
  [
    {
      type: 'tool_use',
      id: 'ov_3',
      name: 'publier_tableau',
      input: {
        series: {
          ca_mensuel: [
            { mois: '2026-06', montant_ht: 14200 },
            { mois: '2026-07', montant_ht: 9850 },
            { mois: '2026-08', montant_ht: 6120 },
            { mois: '2026-09', montant_ht: 17340 },
            { mois: '2026-10', montant_ht: 15980 },
            { mois: '2026-11', montant_ht: 12380 },
          ],
          devis_mensuels: [
            { mois: '2026-06', en_attente: 0, acceptes: 11200, refuses: 2400 },
            { mois: '2026-07', en_attente: 1200, acceptes: 7300, refuses: 3100 },
            { mois: '2026-08', en_attente: 4320, acceptes: 2900, refuses: 650 },
            { mois: '2026-09', en_attente: 5400, acceptes: 9800, refuses: 1800 },
            { mois: '2026-10', en_attente: 10370, acceptes: 4100, refuses: 180 },
            { mois: '2026-11', en_attente: 8090, acceptes: 12400, refuses: 0 },
          ],
          pipeline: [
            { statut: 'envoyé', nombre: 7, montant_ht: 18450 },
            { statut: 'accepté', nombre: 12, montant_ht: 47700 },
            { statut: 'refusé', nombre: 5, montant_ht: 8130 },
            { statut: 'brouillon', nombre: 2, montant_ht: 3090 },
          ],
          impayes_anciennete: [
            { tranche: 'Non échues', nombre: 1, montant_ttc: 1080 },
            { tranche: '1 à 30 j', nombre: 1, montant_ttc: 2160 },
            { tranche: '31 à 60 j', nombre: 0, montant_ttc: 0 },
            { tranche: 'Plus de 60 j', nombre: 0, montant_ttc: 0 },
          ],
        },
        kpis: [
          { cle: 'devis_en_attente', libelle: 'Devis en attente', valeur: 7, unite: 'nombre', detail: 'envoyés, sans réponse' },
          { cle: 'montant_devis_en_attente', libelle: 'Montant en attente', valeur: 18450, unite: 'eur', detail: 'HT' },
          { cle: 'devis_acceptes_mois', libelle: 'Devis acceptés ce mois', valeur: 4, unite: 'nombre', detail: '' },
          { cle: 'taux_transformation', libelle: 'Taux de transformation', valeur: 46, unite: 'pourcent', detail: 'sur 90 jours' },
          { cle: 'ca_facture_mois', libelle: 'CA facturé ce mois', valeur: 12380, unite: 'eur', detail: 'HT, 9 factures' },
          { cle: 'factures_impayees', libelle: 'Factures impayées', valeur: 3240, unite: 'eur', detail: 'TTC, 2 factures' },
        ],
        devis_a_relancer: [
          { ref: 'D-2026-0012', client: 'Martin Dupont', objet: 'Remplacement chauffe-eau', montant_ht: 1450, date: '2026-10-20', statut: 'envoyé', jours: 20 },
          { ref: 'D-2026-0031', client: 'SCI Les Tilleuls', objet: 'Rénovation salle de bain', montant_ht: 8920, date: '2026-10-27', statut: 'envoyé', jours: 13 },
          { ref: 'D-2026-0035', client: 'Mme Leroy', objet: 'Pompe à chaleur air-eau', montant_ht: 6200, date: '2026-11-01', statut: 'envoyé', jours: 8 },
        ],
        derniers_devis: [
          { ref: 'D-2026-0041', client: 'M. Bernard', objet: 'Mise aux normes tableau', montant_ht: 1890, date: '2026-11-08', statut: 'brouillon', jours: null },
          { ref: 'D-2026-0039', client: 'Mairie de Trélazé', objet: 'Sanitaires école', montant_ht: 12400, date: '2026-11-05', statut: 'accepté', jours: null },
          { ref: 'D-2026-0035', client: 'Mme Leroy', objet: 'Pompe à chaleur air-eau', montant_ht: 6200, date: '2026-11-01', statut: 'envoyé', jours: 8 },
          { ref: 'D-2026-0033', client: 'M. Petit', objet: 'Fuite sous évier', montant_ht: 180, date: '2026-10-29', statut: 'refusé', jours: null },
        ],
        factures_impayees: [
          { ref: 'F-2026-0102', client: 'M. Garnier', montant_ttc: 2160, echeance: '2026-10-25', jours_retard: 15 },
          { ref: 'F-2026-0110', client: 'Mme Roux', montant_ttc: 1080, echeance: '2026-11-15', jours_retard: null },
        ],
        a_venir: [
          { date: '2026-11-10', client: 'Mairie de Trélazé', objet: 'Démarrage chantier sanitaires' },
          { date: '2026-11-12', client: 'M. Bernard', objet: 'Visite technique tableau électrique' },
        ],
        manques: ['Le détail des paiements partiels n’est pas fourni par Interfast.'],
        resume: '19 devis envoyés restent sans réponse pour 72 670,73 € HT, certains datant de la mi-août (D0003, D0002, D0004), et 8 factures restent impayées pour 12 156,68 € TTC, dont F0017 de SARL THERMO FUEL (8 765 €). Le planning est vide pour les 14 prochains jours et aucun devis n’a été signé ce mois-ci.',
      },
    },
  ],
];

const llm: Llm = {
  create: async (p) => {
    const step = p.messages.filter((m) => m.role === 'assistant').length;
    if (JSON.stringify(p.system).includes('tableau de bord')) {
      await new Promise((r) => setTimeout(r, 900));
      const content = OVERVIEW[step] ?? OVERVIEW[1]!;
      return { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: p.model, content, stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as BetaMessage;
    }
    const salt = Math.random().toString(36).slice(2, 10);
    const content = (SCENARIO[step] ?? [{ type: 'text', text: '(Démonstration) Le scénario est terminé. Ouvrez une nouvelle séance pour le rejouer — la vraie assistante, elle, répondrait à votre message.' }]).map((b) =>
      b.type === 'tool_use' ? { ...b, id: `${b.id}_${salt}` } : b,
    );
    await new Promise((r) => setTimeout(r, 700));
    return {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: p.model,
      content,
      stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as BetaMessage;
  },
};

const db = pgliteDb(new PGlite());
await applySchema(db);
const interfast = fakeInterfast();
let lastCode = '';
const cfg = loadConfig({ PUBLIC_URL: ORIGIN, ANTHROPIC_API_KEY: 'demo', ENVO_COMMIT: 'demo' });
const api = createApp({
  cfg,
  db,
  mailer: { enabled: true, send: async (m) => void (lastCode = /(\d{6})/.exec(m.subject)?.[1] ?? lastCode) },
  llm,
  mcpFactory: (url, key) => mcpClient({ url, apiKey: key, fetchFn: interfast.fetchFn }),
});

/** Appel interne à l'API, avec la bonne origine (l'anti-CSRF reste actif). */
const call = (path: string, body: unknown, cookie = '') =>
  api.request(`${ORIGIN}${path}`, { method: path.startsWith('/api/settings') && !path.endsWith('test') ? 'PUT' : 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

/** Compte de démonstration : inscrit, réglé, Interfast branché. Rend un cookie de session neuf. */
async function demoSession(): Promise<string> {
  const email = 'paul@demo.envo';
  const exists = (await db.query('SELECT 1 FROM users WHERE email = $1', [email])).length > 0;
  let cookie = '';
  if (!exists) {
    await call('/api/auth/register', { email, password: 'demo-demo-demo', name: 'Paul Dupont' });
    const r = await call('/api/auth/verify', { email, code: lastCode });
    cookie = /envo_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '')![0];
    await call('/api/settings', { company: 'Dupont Plomberie', trade: 'plombier chauffagiste', hourly_rate: 48.5, vat_rate: 10, validity_days: 30, mcp_url: MCP_URL, mcp_key: 'cle-secrete' }, cookie);
    await call('/api/rex', { kind: 'preference', content: 'Toujours proposer le groupe de sécurité neuf avec un chauffe-eau.' }, cookie);
    return cookie;
  }
  const l = await call('/api/auth/login', { email, password: 'demo-demo-demo' });
  const { second } = (await l.json()) as { second: string };
  const v = await call('/api/auth/second/verify', { second, code: lastCode });
  return /envo_session=[^;]+/.exec(v.headers.get('set-cookie') ?? '')![0];
}

const web = new Hono();
web.get('/demo', async (c) => {
  const cookie = await demoSession();
  c.header('Set-Cookie', `${cookie}; Path=/; HttpOnly; SameSite=Lax`);
  return c.redirect('/#/');
});
web.get('/demo/code', (c) => c.text(lastCode ? `Dernier code envoyé : ${lastCode}` : 'Aucun code envoyé pour l’instant.'));
// Derrière l'aperçu de l'app Claude, le navigateur annonce une autre origine : en démo seulement, on la remplace.
web.all('/api/*', (c) => {
  const h = new Headers(c.req.raw.headers);
  if (h.has('origin')) h.set('origin', ORIGIN);
  return api.fetch(new Request(c.req.raw, { headers: h }));
});
web.use('/*', serveStatic({ root: './dist' }));

serve({ fetch: web.fetch, port: PORT, hostname: '0.0.0.0' }, () => console.log(`Démo Envo : ${ORIGIN}/demo`));
