/**
 * Envoi d'e-mails par l'API Mailjet (v3.1), avec un simple fetch.
 *
 * Le VPS n'envoie pas de mail lui-même (pas de serveur mail, et une IP de VPS
 * n'est dans aucune liste de confiance) : tout passe par Mailjet, dont le
 * domaine d'envoi doit être validé (SPF + DKIM) pour ne pas finir en indésirables.
 */
import type { Config } from './config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachment?: { filename: string; contentType: string; base64: string };
  /** Images affichées DANS le message (référencées par `cid:<cid>` dans le HTML). */
  inline?: { cid: string; filename: string; contentType: string; base64: string }[];
}

export interface Mailer {
  readonly enabled: boolean;
  send(mail: Mail): Promise<void>;
}

export function mailjet(cfg: Config['mail'], fetchFn: typeof fetch = fetch): Mailer {
  return {
    enabled: cfg !== null,
    async send(mail) {
      if (!cfg) throw new Error('Envoi d’e-mail non configuré');
      const body = {
        Messages: [
          {
            From: { Email: cfg.from, Name: cfg.fromName },
            To: [{ Email: mail.to }],
            Subject: mail.subject,
            TextPart: mail.text,
            HTMLPart: mail.html,
            ...(mail.replyTo ? { ReplyTo: { Email: mail.replyTo } } : {}),
            ...(mail.attachment
              ? { Attachments: [{ ContentType: mail.attachment.contentType, Filename: mail.attachment.filename, Base64Content: mail.attachment.base64 }] }
              : {}),
            ...(mail.inline?.length
              ? { InlinedAttachments: mail.inline.map((a) => ({ ContentType: a.contentType, Filename: a.filename, ContentID: a.cid, Base64Content: a.base64 })) }
              : {}),
          },
        ],
      };
      const res = await fetchFn('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.secretKey}`).toString('base64')}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Mailjet ${res.status} : ${(await res.text()).slice(0, 300)}`);
    },
  };
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
