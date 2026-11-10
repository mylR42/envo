/**
 * L'application : écran d'entrée sans session, sinon trois écrans — Tableau de
 * bord, AssistDevis, Paramètres. Navigation par le fragment d'URL (#/devis/…),
 * pour que le retour arrière du téléphone fonctionne sans routeur.
 *
 * Téléphone : barre d'onglets en bas (geste du pouce). Ordinateur (≥ 1024 px) :
 * barre latérale. Les deux sont TOUJOURS rendues, la feuille de style choisit.
 */
import { ChatCircleDots, Gear, House, SignOut } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { api, type User } from './lib/api';
import { AuthScreen } from './screens/AuthScreen';
import { Dashboard } from './screens/Dashboard';
import { AssistDevis } from './screens/AssistDevis';
import { Settings } from './screens/Settings';
import { Brand, Logo } from './ui/Brand';

export type Route = { screen: 'home' } | { screen: 'devis'; id?: string; start?: string; voice?: boolean } | { screen: 'settings'; section?: string };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  // « Parler à Envo » (raccourci de l'icône, Assistant Google) : #/devis/voix ouvre une séance en mains libres.
  if (a === 'devis') return { screen: 'devis', id: b && /^[0-9a-f-]{36}$/.test(b) ? b : undefined, voice: b === 'voix' };
  if (a === 'parametres') return { screen: 'settings', section: b };
  return { screen: 'home' };
}

/** « Micael Bonnay » → « MB » ; une adresse → sa première lettre. PUR. */
export const initials = (name: string) => {
  const w = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((w[0]?.[0] ?? '?') + (w.length > 1 ? w[w.length - 1]![0] : '')).toUpperCase();
};

export const go = (path: string) => {
  window.location.hash = path;
};

export interface Me {
  user: User | null;
  mail: boolean;
  assistant: boolean;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  /** Texte de départ d'une nouvelle séance (« Faire le point », « Dicter un devis »). */
  const [pendingStart, setPendingStart] = useState<{ text?: string; voice?: boolean } | null>(null);

  useEffect(() => {
    api
      .get<Me>('/api/auth/me')
      .then(setMe)
      .catch(() => setMe({ user: null, mail: false, assistant: false }));
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setMe((m) => (m ? { ...m, user: null } : m));
    go('/');
  }, []);

  // Arrivée par « Parler à Envo » : nouvelle séance, voix et mains libres.
  useEffect(() => {
    if (route.screen === 'devis' && route.voice && me?.user) {
      setPendingStart({ voice: true });
      go('/devis');
    }
  }, [route, me?.user]);

  if (!me) return <div className="splash" aria-busy="true" />;
  if (!me.user) return <AuthScreen onSignedIn={(user) => setMe({ ...me, user })} />;

  const startSession = (opts: { text?: string; voice?: boolean } = {}) => {
    setPendingStart(opts);
    go('/devis');
  };

  const tabs = [
    { key: 'home', label: 'Tableau de bord', short: 'Accueil', icon: House, path: '/' },
    { key: 'devis', label: 'AssistDevis', short: 'Devis', icon: ChatCircleDots, path: '/devis' },
    { key: 'settings', label: 'Paramètres', short: 'Réglages', icon: Gear, path: '/parametres' },
  ] as const;

  return (
    <div className="app">
      <aside className="side">
        <Brand />
        <nav className="side__nav">
          {tabs.map((t) => (
            <a key={t.key} href={`#${t.path}`} className={route.screen === t.key ? 'is-active' : ''}>
              <t.icon size={20} weight={route.screen === t.key ? 'bold' : 'regular'} /> {t.label}
            </a>
          ))}
        </nav>
        <div className="side__foot">
          <span className="side__user">{me.user.name || me.user.email}</span>
          <button className="link-btn" onClick={logout}>
            <SignOut size={16} /> Se déconnecter
          </button>
        </div>
      </aside>

      {/* En-tête de l'appli : TOUJOURS là sur téléphone et tablette (sur ordinateur, la barre latérale le porte). */}
      <header className="apphead">
        <a href="#/" className="apphead__brand" aria-label="Envo — tableau de bord">
          <Logo size={30} />
          <span className="apphead__name">Envo</span>
          <span className="ver" title="Version de l’application">v{__ENVO_VERSION__}</span>
        </a>
        <span className="apphead__sep" aria-hidden="true" />
        <span className="apphead__page">
          {(() => {
            const t = tabs.find((x) => x.key === route.screen)!;
            return (
              <>
                <t.icon size={18} /> {t.label}
              </>
            );
          })()}
        </span>
        <a href="#/parametres" className="apphead__me" aria-label={`Mon compte : ${me.user.name || me.user.email}`} title={me.user.name || me.user.email}>
          {initials(me.user.name || me.user.email)}
        </a>
      </header>

      <main className="main">
        {route.screen === 'home' && <Dashboard user={me.user} assistant={me.assistant} onStart={startSession} />}
        {route.screen === 'devis' && <AssistDevis key={route.id ?? 'liste'} id={route.id} assistant={me.assistant} start={pendingStart} onStarted={() => setPendingStart(null)} />}
        {route.screen === 'settings' && (
          <Settings
            user={me.user}
            mail={me.mail}
            section={route.section}
            onUser={(u) => setMe({ ...me, user: u })}
            onLogout={logout}
          />
        )}
      </main>

      <nav className="tabbar" aria-label="Navigation">
        {tabs.map((t) => (
          <a key={t.key} href={`#${t.path}`} className={route.screen === t.key ? 'is-active' : ''} aria-current={route.screen === t.key ? 'page' : undefined}>
            <t.icon size={24} weight={route.screen === t.key ? 'bold' : 'regular'} />
            <span>{t.short}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
