/**
 * Gmail par IMAP + SMTP, avec un MOT DE PASSE D'APPLICATION (26/11/2026, voir
 * GMAIL.md) : l'artisan active la validation en deux étapes de son compte
 * Google, crée un mot de passe d'application et le colle dans Paramètres →
 * Gmail. Aucune démarche auprès de Google.
 *
 * Règles :
 * - ⚠️ Les e-mails RESTENT dans Gmail : rien n'est recopié en base, ils sont lus
 *   à la demande. Leur contenu est une DONNÉE pour l'assistante, jamais une
 *   consigne (un e-mail peut contenir n'importe quoi).
 * - ⚠️ Hôtes FIXES (imap.gmail.com, smtp.gmail.com) : rien de ce que tape
 *   l'artisan ne choisit où le serveur se connecte.
 * - ⚠️ Envoyer = une ÉCRITURE : l'outil `mail_envoyer` attend « Valider » comme
 *   une création dans Interfast (server/agent.ts). Chercher, lire, préparer un
 *   brouillon dans Gmail : sans validation.
 * - Le mot de passe d'application est chiffré en base (AES-256-GCM) et ne repart
 *   jamais au navigateur.
 *
 * Une connexion IMAP par opération (ouverte, utilisée, fermée) : quelques appels
 * par séance, pas de connexion à garder ouverte sur le serveur.
 */
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';

export const IMAP_HOST = 'imap.gmail.com';
export const SMTP_HOST = 'smtp.gmail.com';
const TIMEOUT_MS = 30_000;
/** Texte d'un e-mail donné à l'assistante : borné (un fil de 200 réponses ne passe pas en entier). */
export const MAIL_TEXT_MAX = 8000;
export const SEARCH_MAX = 25;

export interface MailSummary {
  id: string;
  de: string;
  objet: string;
  date: string;
  extrait: string;
  non_lu: boolean;
}

export interface MailFull extends MailSummary {
  a: string;
  cc: string;
  texte: string;
  pieces_jointes: string[];
}

export interface OutMail {
  a: string;
  cc?: string;
  objet: string;
  texte: string;
  /** Identifiant (rendu par `search`) de l'e-mail auquel on répond : même fil. */
  en_reponse_a?: string;
}

export interface MailClient {
  readonly email: string;
  /** Se connecte et se déconnecte : la preuve que l'adresse et le mot de passe marchent. */
  verify(): Promise<void>;
  search(q: { requete?: string; non_lus?: boolean; depuis_jours?: number; max?: number }): Promise<MailSummary[]>;
  read(id: string): Promise<MailFull>;
  draft(m: OutMail): Promise<string>;
  send(m: OutMail): Promise<string>;
}

export class MailError extends Error {}

/* ---------------- Pur, testé ---------------- */

/** La recherche Gmail (X-GM-RAW), avec les mêmes mots que dans Gmail : « from:leroy », « devis », « is:unread »… */
export function gmailQuery(q: { requete?: string; non_lus?: boolean; depuis_jours?: number }): string {
  const parts: string[] = [];
  const r = String(q.requete ?? '').replace(/[\r\n"\\]/g, ' ').trim().slice(0, 300);
  if (r) parts.push(r);
  if (q.non_lus) parts.push('is:unread');
  const d = Math.round(Number(q.depuis_jours));
  if (Number.isFinite(d) && d > 0) parts.push(`newer_than:${Math.min(d, 3650)}d`);
  // Sans critère : la boîte de réception, pas tout l'historique.
  if (!r || q.non_lus) parts.push('in:inbox');
  return parts.join(' ');
}

/** HTML → texte lisible (un e-mail sans partie texte). Grossier mais sûr : on n'exécute rien, on enlève. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Coupe l'historique cité d'une réponse (« Le … a écrit : », lignes « > ») : l'essentiel d'abord. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^(le .{3,80} a écrit|on .{3,80} wrote)\s*:\s*$/i.test(l.trim()) || /^-{2,}\s*(original message|message d'origine)/i.test(l.trim())) break;
    if (l.startsWith('>')) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

const addr = (a: AddressObject | AddressObject[] | undefined) => (Array.isArray(a) ? a.map((x) => x.text).join(', ') : (a?.text ?? ''));
const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** Le texte d'un e-mail analysé, borné. PUR. */
export function bodyText(p: Pick<ParsedMail, 'text' | 'html'>): string {
  const t = p.text?.trim() ? p.text : typeof p.html === 'string' ? htmlToText(p.html) : '';
  return stripQuoted(t).slice(0, MAIL_TEXT_MAX);
}

/** Adresses saisies par l'assistante : « a@b.fr, Jean <c@d.fr> » ; au plus 10, toutes valides. */
export function recipients(v: string | undefined): string[] {
  const list = String(v ?? '')
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const ok = list.filter((x) => /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(x) || /^[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(x));
  if (ok.length !== list.length) throw new MailError(`Adresse e-mail invalide : ${list.filter((x) => !ok.includes(x)).join(', ')}`);
  if (ok.length > 10) throw new MailError('Dix destinataires au plus.');
  return ok;
}

/* ---------------- Le vrai Gmail ---------------- */

const withTimeout = <T>(p: Promise<T>, what: string) =>
  Promise.race([p, new Promise<never>((_, ko) => setTimeout(() => ko(new MailError(`Gmail ne répond pas (${what}).`)), TIMEOUT_MS))]);

const explain = (e: unknown): MailError => {
  if (e instanceof MailError) return e;
  const m = String((e as { responseText?: string; message?: string })?.responseText ?? (e as Error)?.message ?? e);
  if (/auth|credentials|invalid|535|login/i.test(m)) return new MailError('Gmail refuse la connexion : vérifiez l’adresse et le mot de passe d’application (validation en deux étapes activée).');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket/i.test(m)) return new MailError('Gmail est injoignable pour l’instant. Réessayez dans un instant.');
  return new MailError(`Gmail : ${m.slice(0, 200)}`);
};

export function gmailClient(email: string, appPassword: string): MailClient {
  const pass = appPassword.replace(/\s+/g, '');

  async function withImap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: { user: email, pass }, logger: false, socketTimeout: TIMEOUT_MS });
    c.on('error', () => {
      /* une erreur de socket est traitée par l'appel en cours */
    });
    try {
      await withTimeout(c.connect(), 'connexion');
      return await withTimeout(fn(c), 'lecture');
    } catch (e) {
      throw explain(e);
    } finally {
      await c.logout().catch(() => c.close());
    }
  }

  /** « Tous les messages » (nom traduit selon la langue du compte : on le trouve par son rôle). */
  async function boxOf(c: ImapFlow, use: '\\All' | '\\Drafts'): Promise<string> {
    const list = await c.list();
    const box = list.find((b) => b.specialUse === use)?.path;
    if (!box) throw new MailError(use === '\\All' ? 'Dossier « Tous les messages » introuvable : activez l’accès IMAP dans Gmail (Paramètres → Transfert et POP/IMAP).' : 'Dossier des brouillons introuvable dans Gmail.');
    return box;
  }

  const summary = async (m: FetchMessageObject): Promise<MailSummary> => {
    let extrait = '';
    if (m.source) {
      try {
        extrait = clean(bodyText(await simpleParser(m.source)), 180);
      } catch {
        extrait = '';
      }
    }
    const from = m.envelope?.from?.[0];
    return {
      id: String(m.uid),
      de: from ? (from.name ? `${from.name} <${from.address ?? ''}>` : (from.address ?? '')) : '',
      objet: clean(m.envelope?.subject ?? '', 200),
      date: (m.envelope?.date ?? m.internalDate ?? new Date(0)) instanceof Date ? new Date(m.envelope?.date ?? m.internalDate ?? 0).toISOString() : String(m.internalDate ?? ''),
      extrait,
      non_lu: !m.flags?.has('\\Seen'),
    };
  };

  async function readIn(c: ImapFlow, id: string): Promise<{ full: MailFull; parsed: ParsedMail }> {
    const uid = Number(id);
    if (!Number.isInteger(uid) || uid <= 0) throw new MailError('Identifiant d’e-mail inconnu.');
    const lock = await c.getMailboxLock(await boxOf(c, '\\All'), { readOnly: true });
    try {
      const head = await c.fetchOne(String(uid), { uid: true, size: true }, { uid: true });
      if (!head) throw new MailError('E-mail introuvable (supprimé ?).');
      // Lecture SANS marquer comme lu (BODY.PEEK) ; un e-mail énorme (pièces jointes) est lu en partie.
      const m = await c.fetchOne(String(uid), { uid: true, envelope: true, flags: true, internalDate: true, source: (head.size ?? 0) > 6_000_000 ? { maxLength: 2_000_000 } : true }, { uid: true });
      if (!m || !m.source) throw new MailError('E-mail illisible.');
      const parsed = await simpleParser(m.source);
      const s = await summary({ ...m, source: undefined });
      return {
        parsed,
        full: {
          ...s,
          extrait: '',
          a: clean(addr(parsed.to), 500),
          cc: clean(addr(parsed.cc), 500),
          texte: bodyText(parsed),
          pieces_jointes: parsed.attachments.filter((x) => x.contentDisposition !== 'inline').map((x) => x.filename ?? 'sans nom').slice(0, 20),
        },
      };
    } finally {
      lock.release();
    }
  }

  /** Le message à envoyer (ou à garder en brouillon), en réponse dans le même fil si demandé. */
  async function compose(m: OutMail): Promise<{ to: string[]; cc: string[]; subject: string; text: string; inReplyTo?: string; references?: string }> {
    const to = recipients(m.a);
    if (!to.length) throw new MailError('Destinataire manquant.');
    const cc = recipients(m.cc);
    const out = { to, cc, subject: clean(m.objet, 300), text: String(m.texte ?? '').slice(0, 20_000) };
    if (!m.en_reponse_a) return out;
    const { parsed } = await withImap((c) => readIn(c, m.en_reponse_a!));
    const refs = [parsed.references, parsed.messageId].flat().filter(Boolean).join(' ');
    return { ...out, inReplyTo: parsed.messageId, references: refs || undefined };
  }

  return {
    email,
    verify: () => withImap(async (c) => void (await boxOf(c, '\\All'))),
    search: (q) =>
      withImap(async (c) => {
        const lock = await c.getMailboxLock(await boxOf(c, '\\All'), { readOnly: true });
        try {
          const uids = (await c.search({ gmraw: gmailQuery(q) }, { uid: true })) || [];
          const max = Math.min(Math.max(1, Math.round(Number(q.max) || 10)), SEARCH_MAX);
          const last = uids.sort((a, b) => a - b).slice(-max);
          if (!last.length) return [];
          const rows = await c.fetchAll(last.join(','), { uid: true, envelope: true, flags: true, internalDate: true, source: { maxLength: 6000 } }, { uid: true });
          const out = await Promise.all(rows.map(summary));
          return out.sort((a, b) => b.date.localeCompare(a.date));
        } finally {
          lock.release();
        }
      }),
    read: (id) => withImap(async (c) => (await readIn(c, id)).full),
    draft: async (m) => {
      const msg = await compose(m);
      const raw = await new MailComposer({ from: email, ...msg }).compile().build();
      return withImap(async (c) => {
        await c.append(await boxOf(c, '\\Drafts'), raw, ['\\Draft', '\\Seen']);
        return 'Brouillon enregistré dans Gmail.';
      });
    },
    send: async (m) => {
      const msg = await compose(m);
      const t = nodemailer.createTransport({ host: SMTP_HOST, port: 465, secure: true, auth: { user: email, pass }, connectionTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS });
      try {
        const r = await withTimeout(t.sendMail({ from: email, ...msg }), 'envoi');
        return `E-mail envoyé (${r.messageId ?? 'sans identifiant'}).`;
      } catch (e) {
        throw explain(e);
      } finally {
        t.close();
      }
    },
  };
}
