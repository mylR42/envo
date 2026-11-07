/**
 * Tableau de bord : l'action principale (nouveau devis, à la voix ou au clavier),
 * ce qui attend l'artisan, ce que l'assistante a fait ce mois-ci, l'état de la
 * connexion Interfast, et ce qu'il reste à régler pour bien démarrer.
 *
 * Aucun chiffre de devis n'est stocké par Envo : « devis créés » compte les
 * séances qui ont abouti à une création DANS Interfast.
 */
import { ArrowRight, Brain, ChatCircleDots, CheckCircle, ClipboardText, Hourglass, Microphone, Plugs, PlugsConnected, Star, Warning } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { api, type ConvSummary, type User } from '../lib/api';
import { relDate, STATUS_LABEL } from '../lib/format';
import { canListen } from '../lib/voice';

interface Dash {
  sessions_month: number;
  quotes_month: number;
  waiting: number;
  avg_rating: number | null;
  validated: number;
  refused: number;
  rex: number;
  interfast: { configured: boolean; calls_week: number; errors_week: number; avg_ms: number | null };
  assistant: boolean;
  profile_complete: boolean;
  recent: ConvSummary[];
}

const hello = (name: string) => {
  const h = new Date().getHours();
  const first = name.split(' ')[0] || '';
  return `${h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour'}${first ? ` ${first}` : ''}`;
};

export function Dashboard({ user, assistant, onStart }: { user: User; assistant: boolean; onStart(o?: { text?: string; voice?: boolean }): void }) {
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Dash>('/api/dashboard').then(setD, (e: Error) => setError(e.message));
  }, []);

  const setup = d
    ? [
        !d.assistant && { text: 'L’assistante n’est pas encore activée sur le serveur (clé Anthropic). Contactez l’administrateur.', href: null },
        !d.interfast.configured && { text: 'Connectez Interfast : collez l’URL du serveur MCP et votre clé API.', href: '#/parametres/interfast' },
        !d.profile_complete && { text: 'Renseignez votre entreprise, votre métier et votre taux horaire : l’assistante chiffrera juste dès le départ.', href: '#/parametres/entreprise' },
      ].filter(Boolean) as { text: string; href: string | null }[]
    : [];

  return (
    <div className="page">
      <header className="page__head">
        <h1>{hello(user.name)}</h1>
        <p className="muted">Que prépare-t-on aujourd’hui ?</p>
      </header>

      <section className="hero card">
        <div className="hero__text">
          <h2>Nouveau devis</h2>
          <p>Décrivez le chantier comme à un collègue : l’assistante retrouve le client et vos devis passés dans Interfast, pose les questions utiles et propose le chiffrage.</p>
        </div>
        <div className="hero__actions">
          {canListen() && (
            <button className="btn btn--accent btn--big" onClick={() => onStart({ voice: true })} disabled={!assistant}>
              <Microphone size={24} weight="regular" /> Dicter un devis
            </button>
          )}
          <button className="btn btn--primary btn--big" onClick={() => onStart()} disabled={!assistant}>
            <ChatCircleDots size={24} weight="regular" /> Écrire un devis
          </button>
          <button className="btn btn--ghost" onClick={() => onStart({ text: 'Fais-moi le point sur mes devis en cours dans Interfast : ceux en attente de réponse, à relancer, et les plus anciens.' })} disabled={!assistant}>
            <ClipboardText size={20} /> Faire le point sur mes devis
          </button>
        </div>
      </section>

      {error && <p className="alert alert--error">{error}</p>}

      {setup.length > 0 && (
        <section className="card setup">
          <h2>
            <Warning size={20} weight="regular" /> Pour bien démarrer
          </h2>
          <ul>
            {setup.map((s) => (
              <li key={s.text}>{s.href ? <a href={s.href}>{s.text} <ArrowRight size={14} /></a> : s.text}</li>
            ))}
          </ul>
        </section>
      )}

      {d && (
        <>
          <section className="stats">
            <a className={`stat card${d.waiting ? ' stat--alert' : ''}`} href="#/devis">
              <Hourglass size={22} weight="light" />
              <strong>{d.waiting}</strong>
              <span>{d.waiting > 1 ? 'séances attendent votre réponse' : 'séance attend votre réponse'}</span>
            </a>
            <div className="stat card">
              <CheckCircle size={22} weight="light" />
              <strong>{d.quotes_month}</strong>
              <span>devis créés dans Interfast ce mois-ci</span>
            </div>
            <div className="stat card">
              <ChatCircleDots size={22} weight="light" />
              <strong>{d.sessions_month}</strong>
              <span>séances avec l’assistante ce mois-ci</span>
            </div>
            <a className="stat card" href="#/parametres/memoire">
              <Brain size={22} weight="light" />
              <strong>{d.rex}</strong>
              <span>habitudes et décisions retenues</span>
            </a>
            <div className="stat card">
              <Star size={22} weight="light" />
              <strong>{d.avg_rating ?? '–'}</strong>
              <span>note moyenne donnée à l’assistante</span>
            </div>
          </section>

          <div className="grid2">
            <section className="card">
              <h2>Dernières séances</h2>
              {d.recent.length === 0 ? (
                <p className="muted">Aucune séance pour l’instant. Lancez votre premier devis ci-dessus.</p>
              ) : (
                <ul className="list">
                  {d.recent.map((c) => (
                    <li key={c.id}>
                      <a href={`#/devis/${c.id}`}>
                        <span className="list__title">{c.title || 'Séance sans titre'}</span>
                        <span className="list__meta">
                          {c.waiting ? <span className="badge badge--warn">À votre tour</span> : <span className={`badge badge--${c.status}`}>{STATUS_LABEL[c.status] ?? c.status}</span>}
                          {relDate(c.updated_at)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>{d.interfast.configured ? <PlugsConnected size={20} /> : <Plugs size={20} />} Interfast</h2>
              {d.interfast.configured ? (
                <>
                  <p>
                    Connecté. Cette semaine : <strong>{d.interfast.calls_week}</strong> consultation{d.interfast.calls_week > 1 ? 's' : ''}
                    {d.interfast.avg_ms !== null && d.interfast.avg_ms >= 100 && <> en {(d.interfast.avg_ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s en moyenne</>}.
                  </p>
                  {d.interfast.errors_week > 0 && <p className="alert alert--warn">{d.interfast.errors_week} erreur{d.interfast.errors_week > 1 ? 's' : ''} d’Interfast cette semaine. Testez la connexion dans Paramètres.</p>}
                  <p className="muted">
                    Actions validées ce mois-ci : {d.validated} · refusées : {d.refused}
                  </p>
                </>
              ) : (
                <p className="muted">Pas encore connecté : l’assistante peut préparer un brouillon, pas le créer.</p>
              )}
              <a className="btn btn--ghost" href="#/parametres/interfast">
                Réglages Interfast <ArrowRight size={16} />
              </a>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
