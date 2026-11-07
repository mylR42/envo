/**
 * Mots de passe et jetons, avec le seul module crypto de Node : aucune dépendance
 * native (argon2, bcrypt) — le serveur est livré en UN fichier compilé, et un
 * module natif ne se compile pas d'avance pour le VPS.
 *
 * scrypt (N = 2^15, r = 8, p = 1) est le réglage recommandé par l'OWASP. Le hash
 * porte ses paramètres : ils pourront monter sans invalider les anciens comptes.
 */
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));

const N = 2 ** 15;
const R = 8;
const P = 1;
const LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, r, p, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Hash de référence pour comparer en temps constant quand le compte n'existe pas. */
export const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Jeton aléatoire (envoyé au client) ; seul son SHA-256 est stocké. */
/** Code à 6 chiffres, tiré uniformément (randomInt, pas Math.random). */
export function newOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const PASSWORD_MIN = 8;

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Nom lisible d'un appareil, tiré de son User-Agent : « iPhone · Safari »,
 * « Windows · Edge ». Sert à la liste « Mes appareils » et à l'alerte de
 * nouvelle connexion — jamais à une décision de sécurité (l'en-tête se falsifie).
 */
export function deviceLabel(ua: string | undefined | null): string {
  const u = ua ?? '';
  const device = /iPad/.test(u)
    ? 'iPad'
    : /iPhone|iPod/.test(u)
      ? 'iPhone'
      : /Android/.test(u)
        ? /Mobile/.test(u) ? 'Téléphone Android' : 'Tablette Android'
        : /Macintosh|Mac OS X/.test(u)
          ? 'Mac'
          : /Windows/.test(u)
            ? 'Windows'
            : /CrOS/.test(u)
              ? 'Chromebook'
              : /Linux/.test(u)
                ? 'Linux'
                : 'Appareil inconnu';
  const browser = /Edg\//.test(u)
    ? 'Edge'
    : /SamsungBrowser/.test(u)
      ? 'Samsung Internet'
      : /Firefox|FxiOS/.test(u)
        ? 'Firefox'
        : /OPR\/|Opera/.test(u)
          ? 'Opera'
          : /CriOS|Chrome\//.test(u)
            ? 'Chrome'
            : /Safari\//.test(u)
              ? 'Safari'
              : '';
  return browser ? `${device} · ${browser}` : device;
}
