/**
 * Siri parle à Envo (/api/voix) : clé vocale (pas de cookie), conversation qui
 * continue d'un appel à l'autre, réponse à dire, et — surtout — une écriture
 * dans Interfast qui ne part qu'avec une formule EXPLICITE.
 */
import { describe, expect, it } from 'vitest';
import { MCP_URL, ORIGIN, setup, signedIn } from './helpers';

const siri = async (env: Awaited<ReturnType<typeof setup>>, token: string, texte: string) => {
  const r = await env.app.request(`${ORIGIN}/api/voix`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ texte }) });
  return { status: r.status, json: JSON.parse(await r.text()) as Record<string, any> };
};

describe('voix (Siri)', () => {
  it('clé : créée une fois, seul son empreinte en base, révocable', async () => {
    const env = await setup();
    const c = await signedIn(env);
    const r = await c.call('POST', '/api/account/voice-tokens', { label: 'iPhone' });
    expect(r.json.token).toMatch(/^envo_/);
    expect(r.json.url).toBe(`${ORIGIN}/api/voix`);
    const rows = await env.db.query<{ token_hash: string }>('SELECT token_hash FROM voice_tokens');
    expect(JSON.stringify(rows)).not.toContain(r.json.token);
    expect((await c.call('GET', '/api/account/voice-tokens')).json.tokens).toHaveLength(1);
    await c.call('DELETE', `/api/account/voice-tokens/${r.json.id}`);
    expect((await siri(env, r.json.token, 'bonjour')).status).toBe(401);
  });

  it('sans clé ou avec une fausse : refus, et le cookie ne suffit pas', async () => {
    const env = await setup();
    const c = await signedIn(env);
    expect((await siri(env, 'n-importe-quoi-de-assez-long', 'bonjour')).status).toBe(401);
    expect((await c.call('POST', '/api/voix', { texte: 'bonjour' })).status).toBe(401);
  });

  it('conversation continue : choix dit, puis validation explicite seulement', async () => {
    const env = await setup({
      script: [
        [{ type: 'text', text: 'Je cherche **M. Dupont**.' }, { type: 'tool_use', id: 'v1', name: 'proposer_choix', input: { question: 'Quelle capacité ?', options: ['150 L', '200 L'] } }],
        [{ type: 'tool_use', id: 'v2', name: 'if_create_quote', input: { customer_id: 'c-42' } }],
        [{ type: 'text', text: 'Devis créé : 690 € HT.' }],
      ],
    });
    const c = await signedIn(env);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    const { token } = (await c.call('POST', '/api/account/voice-tokens')).json;

    const a = await siri(env, token, 'Devis chauffe-eau pour Dupont');
    expect(a.status).toBe(200);
    expect(a.json.reponse).toContain('Je cherche M. Dupont.');
    expect(a.json.reponse).toContain('Vous pouvez répondre : 150 L ou 200 L.');
    expect(a.json.attente).toBe(true);

    // « deux cents litres » n'est pas une option : passé tel quel ; « 200 L » est reconnu.
    const b = await siri(env, token, 'plutôt le 200 L');
    expect(JSON.stringify(env.scripted.requests[1]!.messages.at(-1))).toContain('Réponse de l\'artisan : 200 L');
    expect(b.json.reponse).toMatch(/Pour confirmer, dites : je valide/);
    expect(b.json.conversation).toBe(a.json.conversation);

    // Un « oui » ne valide pas : rien n'est créé.
    await siri(env, token, 'oui');
    expect(env.interfast.calls.filter((x) => x.name === 'create_quote')).toEqual([]);
  });

  it('« je valide » crée le devis, et la réponse est dite en toutes lettres', async () => {
    const env = await setup({
      script: [[{ type: 'tool_use', id: 'w1', name: 'if_create_quote', input: { customer_id: 'c-42' } }], [{ type: 'text', text: 'Devis créé : 690 € HT.' }]],
    });
    const c = await signedIn(env);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    const { token } = (await c.call('POST', '/api/account/voice-tokens')).json;
    await siri(env, token, 'Crée le devis Dupont');
    const r = await siri(env, token, 'Je valide');
    expect(env.interfast.calls.map((x) => x.name)).toEqual(['create_quote']);
    expect(r.json.reponse).toBe('Devis créé : 690 euros hors taxes.');
    expect(r.json.attente).toBe(false);
    // La séance est visible dans l'appli.
    expect((await c.call('GET', '/api/conversations')).json.conversations[0]).toMatchObject({ status: 'devis_cree' });
  });

  it('« nouvelle conversation » repart de zéro', async () => {
    const env = await setup({ script: [[{ type: 'text', text: 'Bonjour.' }], [{ type: 'text', text: 'Re.' }]] });
    const c = await signedIn(env);
    const { token } = (await c.call('POST', '/api/account/voice-tokens')).json;
    const a = await siri(env, token, 'Bonjour');
    const n = await siri(env, token, 'Nouvelle conversation');
    expect(n.json.reponse).toMatch(/repart de zéro/);
    const b = await siri(env, token, 'Salut');
    expect(b.json.conversation).not.toBe(a.json.conversation);
  });
});
