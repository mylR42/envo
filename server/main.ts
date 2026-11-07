/**
 * Point d'entrée du serveur (systemd : envo-api.service). N'écoute que sur
 * 127.0.0.1 : seul nginx, sur la même machine, lui parle.
 */
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { applySchema, connectPostgres } from './db';
import { anthropicLlm } from './llm';
import { mailjet } from './mail';
import { mcpClient } from './mcp';

const cfg = loadConfig();
const db = connectPostgres();
await applySchema(db);

const app = createApp({
  cfg,
  db,
  mailer: mailjet(cfg.mail),
  llm: cfg.anthropic ? anthropicLlm(cfg.anthropic.apiKey) : null,
  mcpFactory: (url, apiKey) => mcpClient({ url, apiKey }),
});

// Ménage quotidien : sessions, codes et inscriptions expirés, journal d'outils de plus de 90 jours.
const menage = async () => {
  try {
    await db.query('DELETE FROM sessions WHERE expires_at < now()');
    await db.query("DELETE FROM login_challenges WHERE expires_at < now() - interval '1 day'");
    await db.query("DELETE FROM pending_signups WHERE expires_at < now() - interval '1 day'");
    await db.query("DELETE FROM tool_log WHERE created_at < now() - interval '90 days'");
  } catch (e) {
    console.error('ménage :', e);
  }
};
setInterval(menage, 24 * 3600_000).unref();
void menage();

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`Envo API ${cfg.commit} sur 127.0.0.1:${info.port} — e-mail : ${cfg.mail ? 'oui' : 'non'}, assistante : ${cfg.anthropic ? cfg.anthropic.model : 'NON (ANTHROPIC_API_KEY absente)'}`);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close();
    void db.close().finally(() => process.exit(0));
  });
}
