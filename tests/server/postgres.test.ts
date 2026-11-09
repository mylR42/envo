/**
 * Le scénario complet sur un VRAI PostgreSQL, par le pilote de production
 * (`postgres`), quand PGHOST est défini (en CI : un service PostgreSQL 16).
 * PGlite ne passe pas par ce pilote : c'est ici que se voit un jsonb encodé deux
 * fois (leçon de Pixo) — l'historique rejoué serait alors une chaîne, pas des blocs.
 */
import { describe, expect, it } from 'vitest';
import { applySchema, connectPostgres } from '../../server/db';
import { MCP_URL, setup, signedIn } from './helpers';

describe.skipIf(!process.env.PGHOST)('PostgreSQL réel', () => {
  it('séance complète : historique, attente, validation, REX', async () => {
    const db = connectPostgres();
    for (const t of ['tool_log', 'actions', 'rex', 'messages', 'conversations', 'settings', 'login_challenges', 'pending_signups', 'sessions', 'users']) await db.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    await applySchema(db);
    const env = await setup({
      db,
      script: [
        [{ type: 'tool_use', id: 'p1', name: 'if_search_customers', input: { query: 'Dupont' } }],
        [{ type: 'tool_use', id: 'p2', name: 'if_create_quote', input: { customer_id: 'c-42', lines: [{ label: 'Chauffe-eau', qty: 1 }] } }],
        [{ type: 'tool_use', id: 'p3', name: 'memoriser', input: { type: 'tarif', contenu: 'Chauffe-eau à 690 €' } }],
        [{ type: 'text', text: 'Créé.' }],
      ],
    });
    try {
      const c = await signedIn(env);
      await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete', hourly_rate: 48.5 });
      expect((await c.call('GET', '/api/settings')).json.settings.hourly_rate).toBe(48.5);
      const conv = (await c.call('POST', '/api/conversations')).json.id as string;
      const t1 = await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Devis Dupont' });
      expect(t1.json.waiting).toEqual([{ id: 'p2', kind: 'confirm' }]);
      const row = (await db.query<{ t: string; p: string }>("SELECT jsonb_typeof(content) AS t, jsonb_typeof(pending) AS p FROM messages m JOIN conversations c ON c.id = m.conversation_id LIMIT 1"))[0]!;
      expect(row).toEqual({ t: 'array', p: 'object' });
      const t2 = await c.call('POST', `/api/conversations/${conv}/turn`, { answers: [{ toolUseId: 'p2', approved: true }] });
      expect(t2.json.conversation.status).toBe('devis_cree');
      expect(env.interfast.calls.map((x) => x.name)).toEqual(['search_customers', 'create_quote']);
      // L'historique relu depuis la base se rejoue tel quel (blocs, pas une chaîne).
      for (let i = 1; i < env.scripted.requests.length; i++) {
        const prev = env.scripted.requests[i - 1]!.messages;
        expect(env.scripted.requests[i]!.messages.slice(0, prev.length)).toEqual(prev);
      }
      const d = await c.call('GET', '/api/dashboard');
      expect(d.json).toMatchObject({ quotes_month: 1, validated: 1, rex: 1 });
    } finally {
      await db.close();
    }
  });
});
