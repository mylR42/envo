/**
 * E-mails d'Envo : tableaux et styles en ligne, 600 px, aucune image distante,
 * version texte toujours fournie. Envo ne demande JAMAIS un mot de passe par
 * e-mail : ne pas le démentir ici.
 */
import { escapeHtml } from './mail';

const shell = (title: string, body: string, preheader: string) => `<!doctype html><html lang="fr"><body style="margin:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px">
<tr><td style="background:#1e3a8a;border-radius:14px 14px 0 0;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold">Envo <span style="color:#fbbf24;font-weight:normal;font-size:14px">· votre assistant personnel</span></td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>${body}</td></tr>
<tr><td style="padding:0 24px 24px;font-size:12px;color:#64748b">Envo ne vous demandera jamais votre mot de passe par e-mail. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</td></tr>
</table></td></tr></table></body></html>`;

export function codeMail(p: { code: string; minutes: number; purpose: 'inscription' | 'connexion' | 'reinitialisation' }) {
  const why = { inscription: 'pour créer votre compte', connexion: 'pour vous connecter', reinitialisation: 'pour choisir un nouveau mot de passe' }[p.purpose];
  const subject = `${p.code} — votre code Envo`;
  const text = `Votre code ${why} : ${p.code}\nIl est valable ${p.minutes} minutes.\n\nEnvo ne vous demandera jamais votre mot de passe par e-mail.`;
  const html = shell(
    `Votre code ${why}`,
    `<p style="margin:0 0 16px">Saisissez ce code dans Envo. Il est valable ${p.minutes} minutes.</p>
<p style="margin:0 0 16px;font-size:32px;letter-spacing:8px;font-weight:bold;color:#1e3a8a">${escapeHtml(p.code)}</p>`,
    `Code : ${p.code}`,
  );
  return { subject, text, html };
}

export function passwordChangedMail(p: { at: Date }) {
  const when = p.at.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  return {
    subject: 'Alerte de sécurité : mot de passe modifié',
    text: `Le mot de passe de votre compte Envo a été modifié le ${when}. Si ce n'est pas vous, utilisez « Mot de passe oublié » tout de suite.`,
    html: shell('Mot de passe modifié', `<p>Le mot de passe de votre compte Envo a été modifié le ${escapeHtml(when)}.</p><p>Si ce n'est pas vous, utilisez « Mot de passe oublié » tout de suite.</p>`, 'Votre mot de passe a été modifié'),
  };
}
