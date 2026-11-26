/**
 * Paramètres → Gmail : brancher SA boîte Gmail (personnelle, pas celle de
 * l'équipe) par un mot de passe d'application. Le pas-à-pas est ici, parce que
 * c'est la seule démarche à faire chez Google. Le mot de passe est essayé avant
 * d'être gardé (chiffré) et ne revient jamais à l'écran.
 */
import { ArrowSquareOut, CheckCircle, EnvelopeSimple, FloppyDisk, Plugs, Trash, Warning } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { relDate } from '../lib/format';
import { Popin } from '../ui/Popin';

interface MailState {
  configured: boolean;
  email: string;
  hint: string;
  last_ok_at: string | null;
}

export function MailSettings({ defaultEmail }: { defaultEmail: string }) {
  const [m, setM] = useState<MailState | null>(null);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [remove, setRemove] = useState(false);

  useEffect(() => {
    api.get<MailState>('/api/mail').then(
      (r) => {
        setM(r);
        setEmail(r.email || (/@(gmail|googlemail)\.com$/i.test(defaultEmail) ? defaultEmail : ''));
      },
      (e: Error) => setMsg({ ok: false, text: e.message }),
    );
  }, [defaultEmail]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setMsg(null);
    try {
      const r = await api.put<MailState>('/api/mail', { email, password: pass });
      setM(r);
      setPass('');
      setMsg({ ok: true, text: 'Gmail est branché. Demandez à l’assistante : « Ai-je des e-mails non lus ? »' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setMsg(null);
    const r = await api.post<{ ok: boolean; error?: string; unread?: number | null }>('/api/mail/test').catch((e: Error) => ({ ok: false, error: e.message, unread: null }));
    setMsg(r.ok ? { ok: true, text: `Connexion à Gmail réussie${typeof r.unread === 'number' ? ` : ${r.unread >= 25 ? '25 e-mails non lus ou plus' : `${r.unread} e-mail${r.unread > 1 ? 's' : ''} non lu${r.unread > 1 ? 's' : ''}`} dans la boîte de réception` : ''}.` } : { ok: false, text: r.error ?? 'Échec' });
    setBusy('');
  };

  return (
    <section className="card section" id="s-gmail">
      <h2>
        <EnvelopeSimple size={20} weight="light" /> Gmail
        {m && <span className={`badge h2__badge ${m.configured ? 'badge--ok' : ''}`}>{m.configured ? 'Branché' : 'Non branché'}</span>}
      </h2>
      <p className="muted">Votre boîte Gmail, à vous seul : l’assistante y cherche et lit vos e-mails, prépare les réponses, et n’envoie rien sans votre « Valider ». Vos e-mails restent dans Gmail.</p>

      {m?.configured && (
        <p className="mailstate">
          <CheckCircle size={18} /> <strong>{m.email}</strong>
          <span className="muted">
            · mot de passe {m.hint}
            {m.last_ok_at && ` · vérifié ${relDate(m.last_ok_at)}`}
          </span>
        </p>
      )}

      <details className="steps" open={!m?.configured}>
        <summary>Comment obtenir le mot de passe d’application (2 minutes)</summary>
        <ol>
          <li>
            Dans votre compte Google, activez la <strong>validation en deux étapes</strong> (Sécurité → Validation en deux étapes).
          </li>
          <li>
            Ouvrez{' '}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer noopener">
              myaccount.google.com/apppasswords <ArrowSquareOut size={14} />
            </a>
            , donnez un nom (« Envo ») et créez le mot de passe.
          </li>
          <li>Copiez les 16 lettres affichées et collez-les ci-dessous, avec votre adresse Gmail.</li>
          <li>Dans Gmail, l’accès IMAP doit être activé (Paramètres → Transfert et POP/IMAP) : c’est le cas par défaut sur les comptes récents.</li>
        </ol>
        <p className="fine">Ce mot de passe ne sert qu’à Envo : vous pouvez le révoquer à tout moment depuis la même page Google, sans changer votre vrai mot de passe.</p>
      </details>

      <form className="form-grid" onSubmit={save}>
        <label className="field">
          <span>Adresse Gmail</span>
          <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@gmail.com" required />
        </label>
        <label className="field">
          <span>Mot de passe d’application {m?.configured ? '(pour le remplacer)' : ''}</span>
          <input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="abcd efgh ijkl mnop" required />
        </label>
        {msg && <p className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'} field--wide`}>{msg.ok ? <CheckCircle size={16} /> : <Warning size={16} />} {msg.text}</p>}
        <div className="row field--wide">
          <button className="btn btn--primary" disabled={busy !== '' || !pass.trim()}>
            <FloppyDisk size={18} /> {busy === 'save' ? 'Vérification auprès de Gmail…' : m?.configured ? 'Remplacer' : 'Brancher Gmail'}
          </button>
          {m?.configured && (
            <>
              <button type="button" className="btn" onClick={test} disabled={busy !== ''}>
                <Plugs size={18} /> {busy === 'test' ? 'Test en cours…' : 'Tester'}
              </button>
              <button type="button" className="link-btn" onClick={() => setRemove(true)}>
                <Trash size={16} /> Débrancher
              </button>
            </>
          )}
        </div>
      </form>

      {remove && (
        <Popin
          tone="danger"
          icon={<Trash size={22} />}
          title="Débrancher Gmail ?"
          confirmLabel="Débrancher"
          cancelLabel="Garder"
          onCancel={() => setRemove(false)}
          onConfirm={async () => {
            setRemove(false);
            const r = await api.del<MailState>('/api/mail').catch(() => null);
            if (r) setM(r);
            setMsg({ ok: true, text: 'Gmail débranché. Pensez à révoquer le mot de passe d’application chez Google.' });
          }}
        >
          <p>L’assistante n’aura plus accès à vos e-mails. Le mot de passe enregistré est effacé d’Envo.</p>
        </Popin>
      )}
    </section>
  );
}
