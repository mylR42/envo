/**
 * Chiffrement des secrets stockés en base (clé API Interfast) : AES-256-GCM,
 * IV aléatoire de 12 octets, tag d'authentification vérifié à la lecture.
 * Format : `v1.<iv>.<tag>.<chiffré>` en base64url. Une clé n'est JAMAIS
 * renvoyée au navigateur : seule sa présence et ses 4 derniers caractères.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(key: Buffer, stored: string): string | null {
  const [v, iv, tag, data] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || data === undefined) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** « ••••a1b2 » : de quoi reconnaître sa clé sans la révéler. */
export function hint(secret: string): string {
  return `••••${secret.slice(-4)}`;
}
