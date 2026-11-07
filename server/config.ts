/**
 * Configuration du serveur, lue dans l'environnement (fichier /srv/envo/envo.env
 * sur le VPS, chargé par systemd).
 *
 * Deux secrets ne se régénèrent JAMAIS :
 * - ENVO_SECRET_KEY chiffre les clés Interfast des comptes (AES-256-GCM). La
 *   changer rend toutes les clés illisibles : chaque artisan devra la ressaisir.
 * - ANTHROPIC_API_KEY, sans laquelle l'assistante ne répond plus (l'app reste
 *   utilisable, l'écran AssistDevis le dit).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface Config {
  publicUrl: string;
  port: number;
  commit: string;
  /** Clé de 32 octets dérivée d'ENVO_SECRET_KEY. */
  secretKey: Buffer;
  anthropic: { apiKey: string; model: string; effort: 'low' | 'medium' | 'high' } | null;
  mail: { apiKey: string; secretKey: string; from: string; fromName: string } | null;
}

function commitFile(): string | null {
  try {
    const v = readFileSync(new URL('./COMMIT', import.meta.url), 'utf8').trim();
    return /^[0-9a-f]{7,40}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  const raw = env.ENVO_SECRET_KEY?.trim();
  if (!raw && publicUrl.startsWith('https://')) throw new Error('ENVO_SECRET_KEY manquante : refus de démarrer en production sans clé de chiffrement');
  // Une phrase quelconque est acceptée : on en dérive 32 octets (SHA-256).
  const secretKey = createHash('sha256').update(raw || 'envo-dev-uniquement').digest();
  const effort = env.ANTHROPIC_EFFORT === 'low' || env.ANTHROPIC_EFFORT === 'high' ? env.ANTHROPIC_EFFORT : 'medium';
  const anthropic = env.ANTHROPIC_API_KEY?.trim()
    ? { apiKey: env.ANTHROPIC_API_KEY.trim(), model: env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5', effort: effort as 'low' | 'medium' | 'high' }
    : null;
  const mail =
    env.MAILJET_API_KEY && env.MAILJET_SECRET_KEY && env.MAIL_FROM
      ? { apiKey: env.MAILJET_API_KEY, secretKey: env.MAILJET_SECRET_KEY, from: env.MAIL_FROM, fromName: env.MAIL_FROM_NAME || 'Envo' }
      : null;
  return {
    publicUrl,
    port: Number(env.PORT ?? 3880),
    commit: env.ENVO_COMMIT ?? commitFile() ?? 'dev',
    secretKey,
    anthropic,
    mail,
  };
}
