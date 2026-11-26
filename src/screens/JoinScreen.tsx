/**
 * « Rejoindre l'équipe » : la page du lien d'invitation (#/rejoindre/<jeton>).
 *
 * - Pas de compte pour cette adresse : prénom, nom, mot de passe, et c'est fait
 *   (le lien reçu par e-mail prouve l'adresse).
 * - Un compte existe : il faut être connecté SUR CETTE ADRESSE. Sinon, on passe
 *   par l'écran d'entrée et on revient ici (`envo.rejoindre`).
 */
import { SignIn, UserPlus, UsersThree, Warning } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent } from 'react';
import { go } from '../App';
import { api, type User } from '../lib/api';
import { Brand } from '../ui/Brand';

interface Invite {
  email: string;
  role: 'admin' | 'membre';
  company: string;
  inviter: string;
  account: boolean;
}

export const JOIN_KEY = 'envo.rejoindre';

export function JoinScreen({ token, user, onJoined, onLogout }: { token: string; user: User | null; onJoined(u: User): void; onLogout(): void }) {
  const [inv, setInv] = useState<Invite | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Invite>(`/api/team/join/${token}`).then(setInv, (e: Error) => setError(e.message));
  }, [token]);

  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ user: User }>('/api/team/join', { token, name, password });
      try {
        sessionStorage.removeItem(JOIN_KEY);
      } catch {
        /* rien */
      }
      onJoined(r.user);
      go('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toLogin = () => {
    try {
      sessionStorage.setItem(JOIN_KEY, token);
    } catch {
      /* rien */
    }
    if (user) onLogout();
    else go('/');
  };

  const team = inv?.company ? `l’équipe ${inv.company}` : 'une équipe';
  const wrongAccount = !!(user && inv && user.email !== inv.email);

  return (
    <div className="auth">
      <div className="auth__intro">
        <Brand />
      </div>
      <form className="card auth__card" onSubmit={join}>
        <h2>
          <UsersThree size={22} weight="light" /> Rejoindre l’équipe
        </h2>
        {!inv && !error && <p className="muted">Lecture de l’invitation…</p>}
        {inv && (
          <p className="join__lead">
            {inv.inviter ? `${inv.inviter} vous invite` : 'Vous êtes invité'} à rejoindre <strong>{team}</strong> dans Envo, comme {inv.role === 'admin' ? 'administrateur' : 'membre'}. Vous partagerez sa connexion Interfast, ses réglages et la mémoire de l’assistante.
          </p>
        )}

        {inv && !inv.account && !user && (
          <>
            <label className="field">
              <span>Adresse e-mail</span>
              <input type="email" value={inv.email} disabled />
            </label>
            <label className="field">
              <span>Votre prénom et nom</span>
              <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field">
              <span>Mot de passe (8 caractères au moins)</span>
              <input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <p className="alert alert--error">{error}</p>}
            <button className="btn btn--primary btn--block" disabled={busy}>
              <UserPlus size={18} /> {busy ? 'Un instant…' : 'Créer mon compte et rejoindre'}
            </button>
          </>
        )}

        {inv && (inv.account || user) && (
          <>
            {!user || wrongAccount ? (
              <>
                <p className="muted">
                  {wrongAccount ? `Vous êtes connecté en tant que ${user!.email}. ` : ''}Connectez-vous avec <strong>{inv.email}</strong> : vous reviendrez ici pour accepter.
                </p>
                {error && <p className="alert alert--error">{error}</p>}
                <button type="button" className="btn btn--primary btn--block" onClick={toLogin}>
                  <SignIn size={18} /> {wrongAccount ? 'Changer de compte' : 'Se connecter'}
                </button>
              </>
            ) : (
              <>
                <p className="alert alert--warn">
                  <Warning size={16} /> Si vous étiez seul dans votre entreprise sur Envo, ses réglages, sa connexion Interfast et sa mémoire sont remplacés par ceux de l’équipe. Vos séances restent à vous.
                </p>
                {error && <p className="alert alert--error">{error}</p>}
                <button className="btn btn--primary btn--block" disabled={busy}>
                  <UsersThree size={18} /> {busy ? 'Un instant…' : 'Rejoindre l’équipe'}
                </button>
              </>
            )}
          </>
        )}

        {!inv && error && (
          <>
            <p className="alert alert--error">{error}</p>
            <button type="button" className="btn btn--block" onClick={() => go('/')}>
              Retour à Envo
            </button>
          </>
        )}
      </form>
    </div>
  );
}
