/**
 * Tableau de bord : la vision de l'ENTREPRISE (lue dans Interfast) et de la
 * CONNEXION, puis l'activité d'Envo.
 *
 * 1. Nouveau devis (dicter / écrire / faire le point).
 * 2. Interfast : résumé du jour, indicateurs, devis à relancer (un appui lance
 *    une séance de relance), factures impayées, derniers devis, à venir.
 *    Collecte en LECTURE SEULE par l'assistante (server/overview.ts), gardée
 *    30 min ; « Actualiser » la relance. Un chiffre qu'Interfast ne fournit pas
 *    est un tiret, jamais un zéro, et « Ce qu'Interfast ne permet pas de savoir » le liste.
 * 3. Connexion : joignable, délai, outils (lecture / modification), activité de
 *    la semaine, dernière erreur.
 * 4. Envo : séances, devis créés, mémoire, note.
 */
import {
  ArrowClockwise,
  ArrowRight,
  Brain,
  CalendarBlank,
  CaretRight,
  ChartBar,
  ChatCircleDots,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  FilePlus,
  FileText,
  HandWaving,
  Hourglass,
  Info,
  Lightning,
  Microphone,
  PaperPlaneTilt,
  PencilSimpleLine,
  Plugs,
  PlugsConnected,
  Receipt,
  Star,
  Warning,
  WarningCircle,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, streamPost, type ConvSummary, type InterfastStatus, type Kpi, type Overview, type User } from '../lib/api';
import { euros, relDate, STATUS_LABEL, toolLabel } from '../lib/format';
import { canListen } from '../lib/voice';
import { PageHead } from '../ui/PageHead';

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

const KPI_ICON: Record<string, typeof FileText> = {
  devis_en_attente: Hourglass,
  montant_devis_en_attente: FileText,
  devis_acceptes_mois: CheckCircle,
  taux_transformation: ChartBar,
  ca_facture_mois: Receipt,
  factures_impayees: WarningCircle,
};

function kpiValue(k: Kpi): string {
  if (k.valeur === null) return '–';
  if (k.unite === 'eur') return euros(k.valeur).replace(/,00\s€$/, ' €');
  if (k.unite === 'pourcent') return `${k.valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %`;
  return k.valeur.toLocaleString('fr-FR');
}

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
};
const ms = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v < 1000 ? `${v} ms` : `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`);

export function Dashboard({ user, assistant, onStart }: { user: User; assistant: boolean; onStart(o?: { text?: string; voice?: boolean }): void }) {
  const [d, setD] = useState<Dash | null>(null);
  const [status, setStatus] = useState<InterfastStatus | null>(null);
  const [ov, setOv] = useState<{ overview: Overview | null; at: string | null } | null>(null);
  const [collecting, setCollecting] = useState('');
  const [ovError, setOvError] = useState('');
  const [error, setError] = useState('');
  const started = useRef(false);

  const collect = useCallback(async () => {
    setOvError('');
    setCollecting('Lecture d’Interfast…');
    try {
      const r = await streamPost<{ overview: Overview; at: string }>('/api/interfast/overview', {}, setCollecting, 'La lecture a été coupée. Réessayez.');
      setOv(r);
      api.get<InterfastStatus>('/api/interfast/status').then(setStatus, () => {});
    } catch (e) {
      setOvError((e as Error).message);
    } finally {
      setCollecting('');
    }
  }, []);

  useEffect(() => {
    api.get<Dash>('/api/dashboard').then(setD, (e: Error) => setError(e.message));
    const st = api.get<InterfastStatus>('/api/interfast/status').then(
      (s) => (setStatus(s), s),
      () => null,
    );
    const o = api.get<{ overview: Overview | null; at: string | null; collecting: boolean }>('/api/interfast/overview').then(
      (r) => (setOv(r), r),
      () => null,
    );
    // Premier passage sans tableau en mémoire : la collecte part toute seule, si Interfast répond.
    void Promise.all([st, o]).then(([s, r]) => {
      if (!started.current && assistant && s?.ok && r && !r.overview && !r.collecting) {
        started.current = true;
        void collect();
      }
    });
  }, [assistant, collect]);

  const relancer = (q: Overview['devis_a_relancer'][number]) =>
    onStart({ text: `Aide-moi à relancer le devis ${q.ref} de ${q.client} (${q.objet}${q.montant_ht !== null ? `, ${q.montant_ht} € HT` : ''}), envoyé il y a ${q.jours ?? '?'} jours : propose-moi un message de relance.` });

  const setup = d
    ? ([
        !d.assistant && { text: 'L’assistante n’est pas encore activée sur le serveur (clé Anthropic).', href: null },
        !d.interfast.configured && { text: 'Connectez Interfast : collez l’URL du serveur MCP et votre clé API.', href: '#/parametres/interfast' },
        !d.profile_complete && { text: 'Renseignez entreprise, métier et taux horaire : l’assistante chiffrera juste dès le départ.', href: '#/parametres/entreprise' },
      ].filter(Boolean) as { text: string; href: string | null }[])
    : [];

  const o = ov?.overview ?? null;
  const connected = status?.ok === true;

  return (
    <div className="page">
      <PageHead
        icon={HandWaving}
        title={hello(user.name)}
        actions={
          connected && assistant ? (
            <button className="btn btn--outline btn--small" onClick={collect} disabled={!!collecting}>
              <ArrowClockwise size={18} className={collecting ? 'spin' : ''} /> Actualiser
            </button>
          ) : undefined
        }
      >
        {o?.resume || 'Que prépare-t-on aujourd’hui ?'}
      </PageHead>

      <section className="hero card">
        <div className="hero__text">
          <h2>
            <FilePlus size={24} weight="light" /> Nouveau devis
          </h2>
          <p>Décrivez le chantier : l’assistante retrouve le client et vos devis passés dans Interfast, pose les questions utiles et propose le chiffrage.</p>
        </div>
        <div className="hero__actions">
          {canListen() && (
            <button className="btn btn--accent btn--big" onClick={() => onStart({ voice: true })} disabled={!assistant}>
              <Microphone size={24} /> Dicter un devis
            </button>
          )}
          <button className="btn btn--primary btn--big" onClick={() => onStart()} disabled={!assistant}>
            <PencilSimpleLine size={24} /> Écrire un devis
          </button>
          <button className="btn btn--ghost" onClick={() => onStart({ text: 'Fais-moi le point sur mes devis en cours dans Interfast : ceux en attente de réponse, à relancer, et les plus anciens.' })} disabled={!assistant}>
            <ClipboardText size={20} /> Faire le point avec l’assistante
          </button>
        </div>
      </section>

      {error && <p className="alert alert--error">{error}</p>}

      {setup.length > 0 && (
        <section className="card setup">
          <h2>
            <Warning size={20} /> Pour bien démarrer
          </h2>
          <ul>
            {setup.map((s) => (
              <li key={s.text}>
                {s.href ? (
                  <a href={s.href}>
                    {s.text} <ArrowRight size={14} />
                  </a>
                ) : (
                  s.text
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------- Interfast : l'entreprise ---------------- */}
      {connected && (
        <section className="biz" aria-label="Mon activité dans Interfast">
          <div className="biz__head">
            <h2>
              <ChartBar size={22} weight="light" /> Mon activité dans Interfast
            </h2>
            <span className="muted biz__when">
              {collecting ? (
                <>
                  <span className="dots" aria-hidden="true" /> {collecting}
                </>
              ) : ov?.at ? (
                `Données de ${new Date(ov.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              ) : null}
            </span>
          </div>

          {ovError && (
            <p className="alert alert--error">
              <Warning size={16} /> {ovError}
            </p>
          )}

          {!o && !collecting && !ovError && assistant && (
            <div className="card empty">
              <ChartBar size={36} weight="light" />
              <p>Le tableau de bord se construit en lisant Interfast (une minute environ).</p>
              <button className="btn btn--primary" onClick={collect}>
                <Lightning size={18} /> Lire Interfast maintenant
              </button>
            </div>
          )}
          {!o && collecting && (
            <div className="kpis" aria-busy="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="kpi card kpi--skeleton" />
              ))}
            </div>
          )}

          {o && (
            <>
              {o.kpis.length > 0 && (
                <div className="kpis">
                  {o.kpis.map((k) => {
                    const I = KPI_ICON[k.cle] ?? ChartBar;
                    return (
                      <div key={k.cle || k.libelle} className={`kpi card${k.cle === 'factures_impayees' && k.valeur ? ' kpi--alert' : ''}`}>
                        <span className="kpi__label">
                          <I size={18} /> {k.libelle}
                        </span>
                        <strong className={k.valeur === null ? 'is-unknown' : ''}>{kpiValue(k)}</strong>
                        {k.detail && <span className="kpi__detail">{k.detail}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid2">
                <section className="card">
                  <h2>
                    <PaperPlaneTilt size={20} /> Devis à relancer
                    {o.devis_a_relancer.length > 0 && <span className="h2__aside">{o.devis_a_relancer.length}</span>}
                  </h2>
                  {o.devis_a_relancer.length === 0 ? (
                    <p className="muted">Aucun devis en attente depuis plus de 7 jours.</p>
                  ) : (
                    <ul className="list">
                      {o.devis_a_relancer.map((q) => (
                        <li key={q.ref + q.client}>
                          <button className="list__btn" onClick={() => relancer(q)} disabled={!assistant}>
                            <span className="list__icon list__icon--warn" aria-hidden="true">
                              <Hourglass size={20} />
                            </span>
                            <span className="list__body">
                              <span className="list__title">
                                {q.client} — {q.objet || q.ref}
                              </span>
                              <span className="list__meta">
                                {q.ref}
                                {q.montant_ht !== null && <> · {euros(q.montant_ht)} HT</>}
                                {q.jours !== null && <span className="badge badge--warn">{q.jours} j sans réponse</span>}
                              </span>
                            </span>
                            <span className="list__cta">
                              Relancer <CaretRight size={16} />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="card">
                  <h2>
                    <Receipt size={20} /> Factures impayées
                  </h2>
                  {o.factures_impayees.length === 0 ? (
                    <p className="muted">{o.manques.some((m) => /factur/i.test(m)) ? 'Non disponible depuis Interfast.' : 'Aucune facture impayée.'}</p>
                  ) : (
                    <ul className="list">
                      {o.factures_impayees.map((f) => (
                        <li key={f.ref + f.client} className="list__static">
                          <span className={`list__icon list__icon--${f.jours_retard ? 'late' : 'warn'}`} aria-hidden="true">
                            <Receipt size={20} />
                          </span>
                          <span className="list__body">
                            <span className="list__title">{f.client}</span>
                            <span className="list__meta">
                              {f.ref}
                              {f.echeance && <> · échéance {day(f.echeance)}</>}
                              {f.jours_retard ? <span className="badge badge--late">{f.jours_retard} j de retard</span> : null}
                            </span>
                          </span>
                          <strong className="list__amount">{f.montant_ttc !== null ? euros(f.montant_ttc) : '–'}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="card">
                  <h2>
                    <FileText size={20} /> Derniers devis
                  </h2>
                  {o.derniers_devis.length === 0 ? (
                    <p className="muted">Aucun devis lu.</p>
                  ) : (
                    <ul className="list">
                      {o.derniers_devis.map((q) => (
                        <li key={q.ref + q.client} className="list__static">
                          <span className={`list__icon list__icon--${/accept|sign/i.test(q.statut) ? 'devis_cree' : /refus/i.test(q.statut) ? 'termine' : 'en_cours'}`} aria-hidden="true">
                            <FileText size={20} />
                          </span>
                          <span className="list__body">
                            <span className="list__title">
                              {q.client} — {q.objet || q.ref}
                            </span>
                            <span className="list__meta">
                              <span className="badge">{q.statut || '?'}</span>
                              {q.date && day(q.date)}
                            </span>
                          </span>
                          <strong className="list__amount">{q.montant_ht !== null ? euros(q.montant_ht) : '–'}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="card">
                  <h2>
                    <CalendarBlank size={20} /> À venir (14 jours)
                  </h2>
                  {o.a_venir.length === 0 ? (
                    <p className="muted">{o.manques.some((m) => /planning|interven|agenda|chantier/i.test(m)) ? 'Planning non disponible depuis Interfast.' : 'Rien de planifié.'}</p>
                  ) : (
                    <ul className="list">
                      {o.a_venir.map((e, i) => (
                        <li key={i} className="list__static">
                          <span className="list__date">{day(e.date)}</span>
                          <span className="list__body">
                            <span className="list__title">{e.client}</span>
                            <span className="list__meta">{e.objet}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              {o.manques.length > 0 && (
                <details className="card gaps">
                  <summary>
                    <Info size={18} /> Ce qu’Interfast ne permet pas de savoir ({o.manques.length})
                  </summary>
                  <ul>
                    {o.manques.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </section>
      )}

      {/* ---------------- Connexion et activité d'Envo ---------------- */}
      <div className="grid2">
        <section className={`card conn${status && status.configured && !status.ok ? ' conn--down' : ''}`}>
          <h2>
            {connected ? <PlugsConnected size={20} /> : <Plugs size={20} />} Connexion Interfast
            <span className={`badge h2__badge ${connected ? 'badge--ok' : status?.configured ? 'badge--late' : ''}`}>{!status ? '…' : connected ? 'Connectée' : status.configured ? 'En erreur' : 'Non configurée'}</span>
          </h2>
          {status?.configured && !status.ok && (
            <p className="alert alert--error">
              <Warning size={16} /> {status.error}
            </p>
          )}
          {status?.configured && (
            <dl className="facts">
              <div>
                <dt>Serveur</dt>
                <dd>{status.host}</dd>
              </div>
              <div>
                <dt>Clé</dt>
                <dd>{status.keyHint || 'dans l’URL'}</dd>
              </div>
              {connected && (
                <>
                  <div>
                    <dt>Temps de réponse</dt>
                    <dd>{ms(status.latencyMs)}</dd>
                  </div>
                  <div>
                    <dt>Outils</dt>
                    <dd>
                      {status.tools?.filter((t) => !t.write).length ?? 0} en lecture · {status.tools?.filter((t) => t.write).length ?? 0} qui modifient (validés par vous)
                    </dd>
                  </div>
                </>
              )}
              <div>
                <dt>Cette semaine</dt>
                <dd>
                  {status.week.calls} appel{status.week.calls > 1 ? 's' : ''}
                  {status.week.calls > 0 && <>, {ms(status.week.avg_ms)} en moyenne</>}
                  {status.week.errors > 0 && <span className="badge badge--late">{status.week.errors} en erreur</span>}
                </dd>
              </div>
              {status.week.last_ok && (
                <div>
                  <dt>Dernier échange réussi</dt>
                  <dd>{relDate(status.week.last_ok)}</dd>
                </div>
              )}
              {status.week.last_error && (
                <div>
                  <dt>Dernière erreur</dt>
                  <dd>{relDate(status.week.last_error)}</dd>
                </div>
              )}
              {status.week.top.length > 0 && (
                <div>
                  <dt>Les plus utilisés</dt>
                  <dd>{status.week.top.map((t) => `${toolLabel(t.tool)} (${t.n})`).join(' · ')}</dd>
                </div>
              )}
            </dl>
          )}
          {status && !status.configured && <p className="muted">Pas encore connecté : l’assistante peut préparer un brouillon, pas le créer.</p>}
          <a className="btn btn--ghost" href="#/parametres/interfast">
            Réglages Interfast <ArrowRight size={16} />
          </a>
        </section>

        <section className="card">
          <h2>
            <ClockCounterClockwise size={20} /> Mes séances avec Envo
            {d?.avg_rating != null && (
              <span className="h2__aside">
                <Star size={16} /> {d.avg_rating.toLocaleString('fr-FR')}/5
              </span>
            )}
          </h2>
          {d && (
            <div className="minis">
              <a href="#/devis" className={d.waiting ? 'is-alert' : ''}>
                <Hourglass size={18} /> <strong>{d.waiting}</strong> à votre tour
              </a>
              <span>
                <CheckCircle size={18} /> <strong>{d.quotes_month}</strong> devis créés ce mois
              </span>
              <span>
                <ChatCircleDots size={18} /> <strong>{d.sessions_month}</strong> séances ce mois
              </span>
              <a href="#/parametres/memoire">
                <Brain size={18} /> <strong>{d.rex}</strong> choses retenues
              </a>
            </div>
          )}
          {d && d.recent.length === 0 && <p className="muted">Aucune séance pour l’instant.</p>}
          {d && d.recent.length > 0 && (
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
      </div>
    </div>
  );
}
