/**
 * Écran d'entrée : connexion (mot de passe PUIS code e-mail), création de
 * compte (code e-mail), mot de passe oublié (code e-mail + nouveau mot de passe).
 * Les messages ne disent jamais si une adresse a un compte.
 */
import { ArrowLeft, EnvelopeSimple, Key, LockKey, SignIn, UserPlus } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { api, type User } from '../lib/api';
import { Brand } from '../ui/Brand';

type Mode = 'login' | 'register' | 'forgot';
type Step = { kind: 'form' } | { kind: 'code'; token?: string; email: string; purpose: Mode };

export function AuthScreen({ onSignedIn }: { onSignedIn(u: User): void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (step.kind === 'code') {
        if (step.purpose === 'register') onSignedIn((await api.post<{ user: User }>('/api/auth/verify', { email: step.email, code })).user);
        else if (step.purpose === 'login') onSignedIn((await api.post<{ user: User }>('/api/auth/second/verify', { second: step.token, code })).user);
        else onSignedIn((await api.post<{ user: User }>('/api/auth/reset', { reset: step.token, code, password: newPassword })).user);
        return;
      }
      if (mode === 'login') {
        const r = await api.post<{ second: string }>('/api/auth/login', { email, password });
        setStep({ kind: 'code', token: r.second, email, purpose: 'login' });
      } else if (mode === 'register') {
        await api.post('/api/auth/register', { email, password, name });
        setStep({ kind: 'code', email, purpose: 'register' });
      } else {
        const r = await api.post<{ reset: string }>('/api/auth/forgot', { email });
        setStep({ kind: 'code', token: r.reset, email, purpose: 'forgot' });
      }
      setCode('');
    });
  };

  const resend = () =>
    void run(async () => {
      if (step.kind !== 'code') return;
      if (step.purpose === 'register') await api.post('/api/auth/register', { email, password, name });
      else await api.post('/api/auth/second/resend', { second: step.token });
      setInfo('Un nouveau code est parti (pensez aux indésirables).');
    });

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep({ kind: 'form' });
    setError('');
    setInfo('');
  };

  return (
    <div className="auth">
      <section className="auth__intro">
        <Brand big />
        <h1>Vos devis, à la voix, en quelques minutes.</h1>
        <p>Envo prépare vos devis avec vous : il retrouve vos clients et vos devis passés dans Interfast, vous pose les bonnes questions, propose les lignes et les prix, et crée le devis quand vous validez.</p>
        <ul className="auth__points">
          <li>Vos données restent dans Interfast.</li>
          <li>Rien n’est créé sans votre validation.</li>
          <li>Il retient vos habitudes d’une fois sur l’autre.</li>
        </ul>
      </section>

      <form className="card auth__card" onSubmit={submit}>
        {step.kind === 'code' ? (
          <>
            <button type="button" className="link-btn" onClick={() => setStep({ kind: 'form' })}>
              <ArrowLeft size={16} /> Retour
            </button>
            <h2>
              <EnvelopeSimple size={22} weight="light" /> Code reçu par e-mail
            </h2>
            <p className="muted">
              {step.purpose === 'forgot' ? 'Si un compte existe pour ' : 'Nous avons envoyé un code à 6 chiffres à '}
              <strong>{step.email}</strong>
              {step.purpose === 'forgot' ? ', un code vient de lui être envoyé.' : '.'} Il est valable 15 minutes.
            </p>
            <label className="field">
              <span>Code à 6 chiffres</span>
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            </label>
            {step.purpose === 'forgot' && (
              <label className="field">
                <span>Nouveau mot de passe (8 caractères au moins)</span>
                <input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              </label>
            )}
            {error && <p className="alert alert--error">{error}</p>}
            {info && <p className="alert alert--info">{info}</p>}
            <button className="btn btn--primary btn--block" disabled={busy}>
              <Key size={18} /> {busy ? 'Vérification…' : 'Valider le code'}
            </button>
            {step.purpose !== 'forgot' && (
              <button type="button" className="link-btn" onClick={resend} disabled={busy}>
                Renvoyer un code
              </button>
            )}
          </>
        ) : (
          <>
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>
                Se connecter
              </button>
              <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => switchMode('register')}>
                Créer un compte
              </button>
            </div>
            {mode === 'forgot' && (
              <>
                <h2>
                  <LockKey size={22} weight="light" /> Mot de passe oublié
                </h2>
                <p className="muted">Saisissez votre adresse : vous recevrez un code pour choisir un nouveau mot de passe.</p>
              </>
            )}
            {mode === 'register' && (
              <label className="field">
                <span>Votre prénom et nom</span>
                <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <label className="field">
              <span>Adresse e-mail</span>
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            {mode !== 'forgot' && (
              <label className="field">
                <span>Mot de passe{mode === 'register' ? ' (8 caractères au moins)' : ''}</span>
                <input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
            )}
            {error && <p className="alert alert--error">{error}</p>}
            <button className="btn btn--primary btn--block" disabled={busy}>
              {mode === 'login' ? <SignIn size={18} /> : mode === 'register' ? <UserPlus size={18} /> : <EnvelopeSimple size={18} />}
              {busy ? 'Un instant…' : mode === 'login' ? 'Recevoir mon code' : mode === 'register' ? 'Créer mon compte' : 'Recevoir un code'}
            </button>
            {mode === 'login' && (
              <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>
                Mot de passe oublié ?
              </button>
            )}
            {mode === 'forgot' && (
              <button type="button" className="link-btn" onClick={() => switchMode('login')}>
                <ArrowLeft size={16} /> Retour à la connexion
              </button>
            )}
            <p className="fine">Connexion protégée : après le mot de passe, un code est envoyé par e-mail. Envo v{__ENVO_VERSION__}</p>
          </>
        )}
      </form>
    </div>
  );
}
