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
const llm: Llm = {
  create: async (p) => {
    const step = p.messages.filter((m) => m.role === 'assistant').length;
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
