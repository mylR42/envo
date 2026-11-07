/**
 * Serveur de DÉMONSTRATION, pour regarder les écrans sans PostgreSQL, sans clé
 * Anthropic ni Interfast : base en mémoire (PGlite), faux Interfast, et une
 * assistante qui joue un scénario écrit d'avance. Exclu du déploiement.
 *
 *   npx esbuild tools/demo-server.ts --bundle --platform=node --format=esm --packages=external --outfile=.demo/demo.mjs && node .demo/demo.mjs
 *   npm run build && npx vite preview   (puis http://localhost:4173, le code de connexion s'affiche ici)
 */
import { PGlite } from '@electric-sql/pglite';
import { serve } from '@hono/node-server';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { applySchema } from '../server/db';
import { mcpClient } from '../server/mcp';
import { fakeInterfast, pgliteDb, scriptedLlm } from '../tests/server/helpers';

const db = pgliteDb(new PGlite());
await applySchema(db);
const interfast = fakeInterfast();
const { llm } = scriptedLlm([
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
    { type: 'tool_use', id: 'tu_5', name: 'if_create_quote', input: { customer_id: 'c-42', title: 'Remplacement chauffe-eau 200 L', lines: [{ label: 'Chauffe-eau électrique 200 L', qty: 1, unit_price: 690, vat: 10 }, { label: 'Groupe de sécurité', qty: 1, unit_price: 45, vat: 10 }] } },
  ],
  [{ type: 'tool_use', id: 'tu_6', name: 'memoriser', input: { type: 'tarif', contenu: 'Chauffe-eau 200 L posé : 690 € HT hors main d’œuvre.' } }],
  [{ type: 'text', text: 'C’est fait : le devis **D-2026-0099** est créé dans Interfast, en brouillon. Voulez-vous que je prépare l’e-mail d’envoi au client ?' }],
]);
const cfg = loadConfig({ PUBLIC_URL: process.env.PUBLIC_URL ?? 'http://localhost:4173', ANTHROPIC_API_KEY: 'demo', ENVO_COMMIT: 'demo' });
const app = createApp({ cfg, db, mailer: { enabled: false, send: async () => {} }, llm, mcpFactory: (url, key) => mcpClient({ url, apiKey: key, fetchFn: interfast.fetchFn }) });
serve({ fetch: app.fetch, port: 3880, hostname: '127.0.0.1' }, () => console.log('démo sur 127.0.0.1:3880'));
