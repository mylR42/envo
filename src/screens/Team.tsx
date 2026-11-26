/**
 * Paramètres → Équipe : plusieurs personnes dans la même entreprise.
 *
 * Partagés par l'équipe : la connexion Interfast, les réglages de l'entreprise,
 * la mémoire de l'assistante. À chacun : ses séances, ses imports, sa clé Siri.
 * Un ADMINISTRATEUR invite (lien par e-mail, 7 jours, une fois), change les
 * rôles et retire ; il en reste toujours un. Chacun peut quitter l'équipe.
 */
import { Crown, EnvelopeSimple, PaperPlaneTilt, SignOut, Trash, User as UserIcon, UserMinus, UsersThree, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type User } from '../lib/api';
import { relDate } from '../lib/format';
import { Popin } from '../ui/Popin';

interface Member {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'membre';
  last_seen: string | null;
  me: boolean;
}
interface Invitation {
  id: string;
  email: string;
  role: 'admin' | 'membre';
  expires_at: string;
}
interface TeamData {
  company: string;
  role: 'admin' | 'membre';
  members: Member[];
  invitations: Invitation[];
}

const ROLE_LABEL = { admin: 'Administrateur', membre: 'Membre' } as const;

export function Team({ user, open, onLeft }: { user: User; open: boolean; onLeft(): void }) {
  const [t, setT] = useState<TeamData | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'membre'>('membre');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<Member | null>(null);
  const admin = user.role === 'admin';

  const load = useCallback(() => api.get<TeamData>('/api/team').then(setT, (e: Error) => setMsg({ ok: false, text: e.message })), []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (open) document.getElementById('s-equipe')?.scrollIntoView({ block: 'start' });
  }, [open]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ ok: true, text: ok });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const to = email.trim();
    if (!to) return;
    void act(async () => {
      await api.post('/api/team/invitations', { email: to, role });
      setEmail('');
    }, `Invitation envoyée à ${to}. Le lien est valable 7 jours.`);
  };

  return (
    <section className="card section" id="s-equipe">
      <h2>
        <UsersThree size={20} weight="light" /> Équipe{t?.company ? ` · ${t.company}` : ''}
      </h2>
      <p className="muted">Toute l’équipe partage la connexion Interfast, les réglages de l’entreprise et la mémoire de l’assistante. Chacun garde ses propres séances.</p>

      <ul className="team">
        {t?.members.map((m) => (
          <li key={m.id}>
            <span className="team__avatar" aria-hidden="true">
              {m.role === 'admin' ? <Crown size={18} /> : <UserIcon size={18} />}
            </span>
            <span className="team__who">
              <strong>
                {m.name || m.email}
                {m.me && <span className="muted"> (vous)</span>}
              </strong>
              <span className="muted">
                {m.email}
                {m.last_seen && ` · vu ${relDate(m.last_seen)}`}
              </span>
            </span>
            {admin ? (
              <select
                className="team__role"
                value={m.role}
                disabled={busy}
                aria-label={`Rôle de ${m.name || m.email}`}
                onChange={(e) => void act(() => api.patch(`/api/team/members/${m.id}`, { role: e.target.value }), 'Rôle modifié.')}
              >
                <option value="admin">{ROLE_LABEL.admin}</option>
                <option value="membre">{ROLE_LABEL.membre}</option>
              </select>
            ) : (
              <span className={`badge${m.role === 'admin' ? ' badge--en_cours' : ''}`}>{ROLE_LABEL[m.role]}</span>
            )}
            {(admin || m.me) && t.members.length > 1 && (
              <button className="icon-btn" disabled={busy} onClick={() => setRemove(m)} aria-label={m.me ? 'Quitter l’équipe' : `Retirer ${m.name || m.email}`} title={m.me ? 'Quitter l’équipe' : 'Retirer de l’équipe'}>
                {m.me ? <SignOut size={18} /> : <UserMinus size={18} />}
              </button>
            )}
          </li>
        ))}
      </ul>

      {admin && (t?.invitations.length ?? 0) > 0 && (
        <>
          <h3 className="team__sub">
            <EnvelopeSimple size={18} /> Invitations en attente
          </h3>
          <ul className="team">
            {t!.invitations.map((i) => (
              <li key={i.id}>
                <span className="team__avatar team__avatar--wait" aria-hidden="true">
                  <PaperPlaneTilt size={18} />
                </span>
                <span className="team__who">
                  <strong>{i.email}</strong>
                  <span className="muted">
                    {ROLE_LABEL[i.role]} · valable jusqu’au {new Date(i.expires_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
                  </span>
                </span>
                <button className="icon-btn" disabled={busy} onClick={() => void act(() => api.del(`/api/team/invitations/${i.id}`), 'Invitation annulée.')} aria-label={`Annuler l’invitation de ${i.email}`} title="Annuler l’invitation">
                  <X size={18} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {admin && (
        <form className="team__invite" onSubmit={invite}>
          <label className="field grow">
            <span>Inviter quelqu’un</span>
            <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="adresse e-mail" required />
          </label>
          <label className="field">
            <span>Rôle</span>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'membre')}>
              <option value="membre">{ROLE_LABEL.membre}</option>
              <option value="admin">{ROLE_LABEL.admin}</option>
            </select>
          </label>
          <button className="btn btn--primary" disabled={busy || !email.trim()}>
            <PaperPlaneTilt size={18} /> Inviter
          </button>
        </form>
      )}
      {admin && <p className="fine">Un administrateur règle l’entreprise, Interfast et l’équipe. Un membre fait tout le reste : devis, planning, imports, mémoire.</p>}
      {msg && <p className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</p>}

      {remove && (
        <Popin
          tone="danger"
          icon={remove.me ? <SignOut size={22} /> : <Trash size={22} />}
          title={remove.me ? 'Quitter l’équipe ?' : `Retirer ${remove.name || remove.email} ?`}
          confirmLabel={remove.me ? 'Quitter' : 'Retirer'}
          cancelLabel="Annuler"
          onCancel={() => setRemove(null)}
          onConfirm={async () => {
            const m = remove;
            setRemove(null);
            await act(() => api.del(`/api/team/members/${m.id}`), m.me ? undefined : 'Retiré de l’équipe.');
            if (m.me) onLeft();
          }}
        >
          <p>
            {remove.me ? 'Vous' : 'Cette personne'} perd l’accès à Interfast et aux réglages de l’équipe. {remove.me ? 'Vos' : 'Ses'} séances et imports sont supprimés (ils contiennent les données de l’entreprise) ; la mémoire écrite reste à l’équipe.
            {remove.me ? ' Vous serez déconnecté.' : ''}
          </p>
        </Popin>
      )}
    </section>
  );
}
