/**
 * Tableau de bord : l'action principale (nouveau devis, à la voix ou au clavier),
 * ce qui attend l'artisan, ce que l'assistante a fait ce mois-ci, l'état de la
 * connexion Interfast, et ce qu'il reste à régler pour bien démarrer.
 *
 * Aucun chiffre de devis n'est stocké par Envo : « devis créés » compte les
 * séances qui ont abouti à une création DANS Interfast.
 */
import { ArrowRight, Brain, CaretRight, ChatCircleDots, CheckCircle, ClipboardText, ClockCounterClockwise, FilePlus, FileText, HandWaving, Hourglass, Microphone, PencilSimpleLine, Plugs, PlugsConnected, Star, Warning } from '@phosphor-icons/react';
import { PageHead } from '../ui/PageHead';
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
      <PageHead icon={HandWaving} title={hello(user.name)}>
        Que prépare-t-on aujourd’hui ?
      </PageHead>

      <section className="hero card">
        <div className="hero__text">
          <h2>
            <FilePlus size={24} weight="light" /> Nouveau devis
          </h2>
          <p>Décrivez le chantier comme à un collègue : l’assistante retrouve le client et vos devis passés dans Interfast, pose les questions utiles et propose le chiffrage.</p>
        </div>
        <div className="hero__actions">
          {canListen() && (
            <button className="btn btn--accent btn--big" onClick={() => onStart({ voice: true })} disabled={!assistant}>
              <Microphone size={24} weight="regular" /> Dicter un devis
            </button>
          )}
          <button className="btn btn--primary btn--big" onClick={() => onStart()} disabled={!assistant}>
            <PencilSimpleLine size={24} weight="regular" /> Écrire un devis
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
              <Hourglass size={24} weight="light" />
              <strong>{d.waiting}</strong>
              <span>à votre tour</span>
            </a>
            <div className="stat card">
              <CheckCircle size={24} weight="light" />
              <strong>{d.quotes_month}</strong>
              <span>devis créés ce mois</span>
            </div>
            <div className="stat card">
              <ChatCircleDots size={24} weight="light" />
              <strong>{d.sessions_month}</strong>
              <span>séances ce mois</span>
            </div>
            <a className="stat card" href="#/parametres/memoire">
              <Brain size={24} weight="light" />
              <strong>{d.rex}</strong>
              <span>choses retenues</span>
            </a>
          </section>

          <div className="grid2">
            <section className="card">
              <h2>
                <ClockCounterClockwise size={20} /> Dernières séances
                {d.avg_rating !== null && (
                  <span className="h2__aside">
                    <Star size={16} /> {d.avg_rating.toLocaleString('fr-FR')}/5
                  </span>
                )}
              </h2>
              {d.recent.length === 0 ? (
                <p className="muted">Aucune séance pour l’instant. Lancez votre premier devis ci-dessus.</p>
              ) : (
                <ul className="list">
                  {d.recent.map((c) => (
                    <li key={c.id}>
                      <a href={`#/devis/${c.id}`}>
                        <span className={`list__icon list__icon--${c.waiting ? 'warn' : c.status}`} aria-hidden="true">
                          {c.waiting ? <Hourglass size={20} /> : c.status === 'devis_cree' ? <FileText size={20} /> : <ChatCircleDots size={20} />}
                        </span>
                        <span className="list__body">
                          <span className="list__title">{c.title || 'Séance sans titre'}</span>
                          <span className="list__meta">
                            {c.waiting ? <span className="badge badge--warn">À votre tour</span> : <span className={`badge badge--${c.status}`}>{STATUS_LABEL[c.status] ?? c.status}</span>}
                            {relDate(c.updated_at)}
                          </span>
                        </span>
                        <CaretRight size={18} className="list__go" aria-hidden="true" />
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
                  <p className="muted iconline">
                    <CheckCircle size={16} /> Ce mois-ci : {d.validated} action{d.validated > 1 ? 's' : ''} validée{d.validated > 1 ? 's' : ''}, {d.refused} refusée{d.refused > 1 ? 's' : ''}
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
