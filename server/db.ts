/**
 * Accès à PostgreSQL derrière une interface minuscule (`query`), pour que les
 * tests tournent sur PGlite et la production sur le pilote `postgres`. Même SQL
 * des deux côtés. Requêtes TOUJOURS paramétrées ($1, $2…).
 *
 * ⚠️ Les DONNÉES MÉTIER (clients, devis, articles) vivent dans Interfast, et
 * nulle part ailleurs. Cette base ne garde que :
 * - les comptes et sessions d'Envo ;
 * - les réglages de l'artisan (dont sa clé Interfast, chiffrée) ;
 * - les conversations avec l'assistante (pour les reprendre) ;
 * - le REX : décisions, préférences et avis qui améliorent l'assistante.
 *
 * ⚠️ Le JSON part en TEXTE, transtypé en jsonb (`$n::text::jsonb`) : passé tel
 * quel, le pilote `postgres` l'encode une seconde fois (leçon de Pixo).
 */
import postgres from 'postgres';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/** Sur le VPS : socket Unix et authentification « peer » (PGHOST, PGDATABASE, PGUSER). */
export function connectPostgres(): Db {
  const sql = postgres({ max: 5, idle_timeout: 30, onnotice: () => {} });
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await sql.unsafe(text, params as never[])) as unknown as T[],
    close: () => sql.end({ timeout: 5 }),
  };
}

/**
 * Schéma : uniquement des créations idempotentes, appliquées à chaque démarrage.
 * Une évolution s'ajoute à la suite en `ALTER TABLE … ADD COLUMN IF NOT EXISTS`,
 * jamais de suppression dans ce fichier.
 */
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     email text NOT NULL UNIQUE,
     password_hash text NOT NULL,
     name text NOT NULL DEFAULT '',
     password_changed_at timestamptz NOT NULL DEFAULT now(),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash text PRIMARY KEY,
     id uuid NOT NULL DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     device text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at timestamptz,
     expires_at timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  // Inscription en attente : le compte n'existe qu'une fois le code reçu par e-mail saisi.
  `CREATE TABLE IF NOT EXISTS pending_signups (
     email text PRIMARY KEY,
     password_hash text NOT NULL,
     name text NOT NULL DEFAULT '',
     code_hash text NOT NULL,
     attempts integer NOT NULL DEFAULT 0,
     sends integer NOT NULL DEFAULT 1,
     window_start timestamptz NOT NULL,
     sent_at timestamptz NOT NULL,
     expires_at timestamptz NOT NULL
   )`,
  // Étape de connexion en attente du code e-mail (double authentification), ou d'une réinitialisation.
  `CREATE TABLE IF NOT EXISTS login_challenges (
     token_hash text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     purpose text NOT NULL,
     code_hash text NOT NULL,
     attempts integer NOT NULL DEFAULT 0,
     sends integer NOT NULL DEFAULT 1,
     sent_at timestamptz NOT NULL,
     expires_at timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS login_challenges_user ON login_challenges(user_id)`,
  // Réglages de l'artisan : entreprise, habitudes de chiffrage, connexion Interfast (clé CHIFFRÉE).
  `CREATE TABLE IF NOT EXISTS settings (
     user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     company text NOT NULL DEFAULT '',
     trade text NOT NULL DEFAULT '',
     hourly_rate numeric,
     vat_rate numeric,
     margin_pct numeric,
     travel_fee numeric,
     validity_days integer,
     notes text NOT NULL DEFAULT '',
     mcp_url text NOT NULL DEFAULT '',
     mcp_key_enc text,
     mcp_key_hint text NOT NULL DEFAULT '',
     voice_reply boolean NOT NULL DEFAULT false,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  // Une séance avec l'assistante. `pending` : ce qu'elle attend de l'artisan (choix, validation).
  `CREATE TABLE IF NOT EXISTS conversations (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind text NOT NULL DEFAULT 'devis',
     title text NOT NULL DEFAULT '',
     status text NOT NULL DEFAULT 'en_cours',
     context text NOT NULL DEFAULT '',
     pending jsonb,
     outcome text NOT NULL DEFAULT '',
     rating integer,
     feedback text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS conversations_user ON conversations(user_id, updated_at DESC)`,
  // Les messages au format de l'API Claude, rejoués TELS QUELS (historique en ajout seul).
  `CREATE TABLE IF NOT EXISTS messages (
     id bigserial PRIMARY KEY,
     conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role text NOT NULL,
     content jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, id)`,
  // REX : ce que l'assistante a appris de l'artisan (décisions, préférences, avis).
  `CREATE TABLE IF NOT EXISTS rex (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind text NOT NULL,
     content text NOT NULL,
     tags text NOT NULL DEFAULT '',
     source_conversation uuid REFERENCES conversations(id) ON DELETE SET NULL,
     uses integer NOT NULL DEFAULT 0,
     last_used_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS rex_user ON rex(user_id, created_at DESC)`,
  // Chaque action d'ÉCRITURE proposée sur Interfast : ce qui a été montré, et ce que l'artisan a décidé.
  `CREATE TABLE IF NOT EXISTS actions (
     tool_use_id text PRIMARY KEY,
     conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     tool text NOT NULL,
     input jsonb NOT NULL,
     state text NOT NULL,
     result text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now(),
     decided_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS actions_user ON actions(user_id, created_at DESC)`,
  // Journal des appels d'outils : temps, succès — pour le tableau de bord et le diagnostic.
  `CREATE TABLE IF NOT EXISTS tool_log (
     id bigserial PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
     tool text NOT NULL,
     ok boolean NOT NULL,
     ms integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS tool_log_user ON tool_log(user_id, created_at DESC)`,
  // Tableau de bord (09/11/2026) : la « recette » des appels Interfast de la dernière collecte (outils + arguments, aucune donnée métier).
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS overview_recipe jsonb`,
];

export async function applySchema(db: Db): Promise<void> {
  for (const stmt of SCHEMA) await db.query(stmt);
}
