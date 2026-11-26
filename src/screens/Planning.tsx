/**
 * Planning (0.8.0) — la semaine lue dans Interfast, par jour et par intervenant.
 * L'import d'un planning fournisseur en PDF est un AUTRE écran (menu « Import
 * PDF », screens/Import.tsx) : deux fonctions, deux entrées de menu.
 *
 * - Lecture SEULE ici (server/planning.ts) : affiché tout de suite depuis la
 *   mémoire du serveur ou la copie de l'appareil, relu derrière s'il a plus de
 *   10 minutes. Rien d'inventé : ce qu'Interfast ne dit pas n'est pas montré.
 * - Modifier ou planifier passe par l'assistante (séance AssistDevis), au
 *   clavier ou À LA VOIX (« Dicter un RDV », Siri) : elle contrôle le client,
 *   l'adresse, la date, la personne et les conflits ; l'artisan valide.
 * - Lisibilité (26/11/2026, « catastrophique ») : d'abord À VENIR et la semaine
 *   en chiffres (RDV, conflits, charge, jours libres), le point de la semaine
 *   replié, puis les jours en LIGNES (heure à gauche) — jamais 7 colonnes
 *   étroites. Jours affichés réglables (5, 6, 7 ; dimanche masqué d'office).
 */
import {
  ArrowClockwise,
  CalendarCheck,
  Microphone,
  Warning,
  SlidersHorizontal,
  CalendarBlank,
  CalendarPlus,
  CaretLeft,
  CaretRight,
  MapPin,
  PencilSimple,
  Truck,
  UserCircle,
  Users,
  Wrench,
  Handshake,
  HardHat,
  DotsThreeCircle,
  Info,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brief } from '../ui/Brief';
import { canListen } from '../lib/voice';
import { api, type PlanEvent, type PlanningState, type User } from '../lib/api';
import { useOffline } from '../lib/offline';
import { addDays, conflicts, dayLabel, load, mondayOf, nowHHMM, todayIso, upcoming, visibleDays, weekLabel, whenLabel } from '../lib/planning';
import { PageHead } from '../ui/PageHead';

const TYPE: Record<PlanEvent['type'], { label: string; icon: typeof Wrench }> = {
  intervention: { label: 'Intervention', icon: Wrench },
  chantier: { label: 'Chantier', icon: HardHat },
  rdv: { label: 'Rendez-vous', icon: Handshake },
  livraison: { label: 'Livraison', icon: Truck },
  autre: { label: 'Autre', icon: DotsThreeCircle },
};

const store = {
  get<T>(k: string): T | null {
    try {
      return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* navigation privée */
    }
  },
};

export function Planning({ user, assistant, onStart }: { user: User; assistant: boolean; onStart(o: { text?: string; voice?: boolean }): void }) {
  const [du, setDu] = useState(() => mondayOf(todayIso()));
  const key = `envo.planning.${user.id}.${du}`;
  const [st, setSt] = useState<PlanningState | null>(() => store.get<PlanningState>(key));
  const [error, setError] = useState('');
  const [who, setWho] = useState<string>('');
  /** Jours affichés (5, 6, 7) : goût personnel, gardé sur le serveur (Paramètres n'en a pas besoin : il se règle ici). */
  const [nDays, setNDays] = useState<number>(() => store.get<number>('envo.planning.jours') ?? 6);
  const [showPrefs, setShowPrefs] = useState(false);
  const poll = useRef(0);
  const net = useOffline();
  const reading = st?.job?.state === 'en_cours';

  const follow = useCallback(
    async (week: string) => {
      const mine = ++poll.current;
      for (let misses = 0; misses < 30; ) {
        await new Promise((r) => setTimeout(r, 1000));
        if (mine !== poll.current) return;
        try {
          const r = await api.get<PlanningState>(`/api/planning?du=${week}`);
          misses = 0;
          if (r.job?.state === 'en_cours') {
            setSt((s) => ({ ...(s ?? r), job: r.job }));
            continue;
          }
          if (r.job?.state === 'erreur') setError(r.job.error ?? 'La lecture du planning n’a pas abouti.');
          setSt(r);
          if (r.planning) store.set(`envo.planning.${user.id}.${week}`, r);
          return;
        } catch {
          misses++;
        }
      }
      setError('Plus de nouvelles du serveur. Vérifiez la connexion, puis « Actualiser ».');
    },
    [user.id],
  );

  const read = useCallback(
    async (week: string) => {
      setError('');
      try {
        const r = await api.post<{ job: PlanningState['job'] }>('/api/planning', { du: week });
        setSt((s) => (s ? { ...s, job: r.job } : s));
        void follow(week);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [follow],
  );

  useEffect(() => {
    let off = false;
    setSt(store.get<PlanningState>(key));
    setError('');
    api.get<PlanningState>(`/api/planning?du=${du}`).then(
      (r) => {
        if (off) return;
        if (r.planning || !store.get(key)) setSt(r);
        if (r.planning) store.set(key, r);
        if (r.days) {
          setNDays(r.days);
          store.set('envo.planning.jours', r.days);
        }
        if (r.job?.state === 'en_cours') void follow(du);
        else if (r.configured && r.assistant && (!r.planning || r.stale) && navigator.onLine) void read(du);
      },
      (e: Error) => !off && setError(e.message),
    );
    return () => {
      off = true;
      poll.current++;
    };
  }, [du, key, follow, read]);

  const p = st?.planning ?? null;
  const all = p?.evenements ?? [];
  const events = all.filter((e) => !who || e.intervenants.includes(who) || (who === '—' && e.intervenants.length === 0));
  const days = visibleDays(du, nDays, events);
  const today = todayIso();
  const live = assistant && net.online;
  const clash = conflicts(events);
  const clashDays = new Set(clash.map((c) => c.date));
  // À venir : depuis maintenant sur la semaine en cours ; sinon, le début de la semaine affichée.
  const next = du === mondayOf(today) ? upcoming(events, today, nowHHMM(), 3) : upcoming(events, du, '00:00', 3);
  const charge = load(events);
  const free = days.filter((d) => !events.some((e) => e.date === d) && d >= today);

  const setDays = async (n: number) => {
    setNDays(n);
    store.set('envo.planning.jours', n);
    setShowPrefs(false);
    await api.put('/api/settings', { planning_days: n }).catch(() => {});
  };

  const edit = (e: PlanEvent) =>
    onStart({
      text: `Dans le planning Interfast, je veux modifier : « ${e.objet} »${e.client ? ` chez ${e.client}` : ''}, le ${dayLabel(e.date)}${e.debut ? ` à ${e.debut}` : ''}${e.ref ? ` (réf. ${e.ref})` : ''}.`,
    });
  const plan = (day?: string) => onStart({ text: day ? `Je veux planifier un rendez-vous le ${dayLabel(day)}.` : 'Je veux planifier un rendez-vous.' });
  const goDay = (d: string) => document.getElementById(`jour-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="page page--planning">
      <PageHead
        icon={CalendarBlank}
        title="Planning"
        actions={
          <div className="quick">
            {canListen() && (
              <button className="btn btn--accent" onClick={() => onStart({ voice: true })} disabled={!live}>
                <Microphone size={20} /> Dicter un RDV
              </button>
            )}
            <button className="btn btn--primary" onClick={() => plan()} disabled={!live}>
              <CalendarPlus size={20} /> Planifier
            </button>
          </div>
        }
      >
        Lu dans Interfast. Pour prendre un RDV, dites-le : l’assistante vérifie le client, l’adresse et les conflits, puis vous validez. « Dis Siri, Envo » marche aussi.
      </PageHead>

      {st && !st.configured && (
        <a className="alert alert--info alert--link" href="#/parametres/interfast">
          <Info size={18} /> Connectez Interfast pour voir votre planning ici.
        </a>
      )}
      {error && <p className="alert alert--error">{error}</p>}

      <div className="weekbar">
        <button className="icon-btn" onClick={() => setDu(addDays(du, -7))} aria-label="Semaine précédente" title="Semaine précédente">
          <CaretLeft size={20} />
        </button>
        <strong className="weekbar__label">
          <span className="weekbar__pre">Semaine du </span>
          {weekLabel(du).replace('Semaine du ', '')}
        </strong>
        <button className="icon-btn" onClick={() => setDu(addDays(du, 7))} aria-label="Semaine suivante" title="Semaine suivante">
          <CaretRight size={20} />
        </button>
        {du !== mondayOf(today) && (
          <button className="btn btn--small btn--ghost" onClick={() => setDu(mondayOf(today))}>
            <CalendarCheck size={16} /> Cette semaine
          </button>
        )}
        <span className="weekbar__tools">
          {reading && <ArrowClockwise size={16} className="spin" aria-label={st?.job?.status || 'Lecture d’Interfast…'} />}
          <button className={`icon-btn icon-btn--sm${showPrefs ? ' is-on' : ''}`} onClick={() => setShowPrefs(!showPrefs)} aria-expanded={showPrefs} aria-label="Jours affichés" title="Jours affichés">
            <SlidersHorizontal size={18} />
          </button>
          {assistant && st?.configured && (
            <button className="icon-btn icon-btn--sm" onClick={() => read(du)} disabled={reading || !net.online} aria-label="Actualiser depuis Interfast" title={st?.at ? `Lu à ${new Date(st.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — actualiser` : 'Actualiser'}>
              <ArrowClockwise size={18} />
            </button>
          )}
        </span>
      </div>

      {showPrefs && (
        <div className="card plan-prefs">
          <span>Jours affichés</span>
          <div className="segmented" role="group" aria-label="Jours affichés">
            {[
              [5, 'Lun.–ven.'],
              [6, 'Lun.–sam.'],
              [7, '7 jours'],
            ].map(([n, l]) => (
              <button key={n} className={nDays === n ? 'is-on' : ''} aria-pressed={nDays === n} onClick={() => void setDays(n as number)}>
                {l}
              </button>
            ))}
          </div>
          <span className="muted">Un jour masqué qui a un rendez-vous reste affiché.</span>
        </div>
      )}

      {/* ---------- L'essentiel : à venir, puis la semaine en chiffres ---------- */}
      {p && (
        <section className="card upnext" aria-label="À venir">
          <h2>
            <CalendarCheck size={20} /> À venir
          </h2>
          {next.length === 0 ? (
            <p className="muted">Plus rien de prévu cette semaine{who ? ` pour ${who === '—' ? 'les non affectés' : who}` : ''}.</p>
          ) : (
            <ul>
              {next.map((e, i) => {
                const T = TYPE[e.type];
                return (
                  <li key={`${e.ref}-${i}`}>
                    <button className="upnext__item" onClick={() => goDay(e.date)}>
                      <span className="upnext__when">
                        <strong>{whenLabel(e.date, today)}</strong>
                        <span>{e.debut ? `${e.debut}${e.fin ? `–${e.fin}` : ''}` : 'Journée'}</span>
                      </span>
                      <span className="upnext__what">
                        <strong>
                          <T.icon size={16} /> {e.objet || T.label}
                        </strong>
                        <span className="muted">{[e.client, e.lieu].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="weekstats">
            <span className="wchip">
              <CalendarBlank size={16} /> {events.length} RDV
            </span>
            {clash.length > 0 && (
              <button className="wchip wchip--warn" onClick={() => goDay(clash[0]!.date)}>
                <Warning size={16} weight="bold" /> {clash.length} conflit{clash.length > 1 ? 's' : ''}
              </button>
            )}
            {charge.map((c) => (
              <span key={c.qui} className="wchip">
                <UserCircle size={16} /> {c.qui} · {c.n}
              </span>
            ))}
            {free.length > 0 && (
              <span className="wchip wchip--free">
                <CalendarPlus size={16} /> Libre : {free.map((d) => dayLabel(d).split(' ')[0]).join(', ')}
              </span>
            )}
          </div>
        </section>
      )}

      {p?.resume && <Brief label="Le point de la semaine" text={p.resume} at={st?.at ?? null} />}

      {p && p.intervenants.length > 1 && (
        <div className="chips" role="group" aria-label="Intervenant">
          <button className={`chip${!who ? ' is-on' : ''}`} aria-pressed={!who} onClick={() => setWho('')}>
            <Users size={16} /> Tout le monde
          </button>
          {p.intervenants.map((n) => (
            <button key={n} className={`chip${who === n ? ' is-on' : ''}`} aria-pressed={who === n} onClick={() => setWho(who === n ? '' : n)}>
              <UserCircle size={16} /> {n}
            </button>
          ))}
          {all.some((e) => e.intervenants.length === 0) && (
            <button className={`chip${who === '—' ? ' is-on' : ''}`} aria-pressed={who === '—'} onClick={() => setWho(who === '—' ? '' : '—')}>
              <UserCircle size={16} /> Non affecté
            </button>
          )}
        </div>
      )}

      {!p && reading && (
        <div className="week" aria-busy="true">
          {days.slice(0, 3).map((d) => (
            <div key={d} className="day card day--skeleton" />
          ))}
        </div>
      )}

      {/* ---------- La semaine, jour par jour (une ligne par RDV, lisible même sur grand écran) ---------- */}
      {p && (
        <div className={`week${reading ? ' is-refreshing' : ''}`}>
          {days.map((d) => {
            const list = events.filter((e) => e.date === d);
            return (
              <section key={d} id={`jour-${d}`} className={`day card${d === today ? ' day--today' : ''}${d < today ? ' day--past' : ''}`} aria-label={dayLabel(d)}>
                <h2 className="day__head">
                  <span>{whenLabel(d, today) === dayLabel(d) ? dayLabel(d) : `${whenLabel(d, today)} · ${dayLabel(d)}`}</span>
                  {clashDays.has(d) && (
                    <span className="badge badge--late">
                      <Warning size={12} weight="bold" /> Conflit
                    </span>
                  )}
                  {list.length > 0 && <span className="badge">{list.length}</span>}
                </h2>
                {list.length === 0 ? (
                  <button className="day__empty" onClick={() => plan(d)} disabled={!live}>
                    <CalendarPlus size={16} /> Rien de prévu — planifier
                  </button>
                ) : (
                  <ul className="evts">
                    {list.map((e, i) => {
                      const T = TYPE[e.type];
                      const late = clash.some((c) => c.a === e || c.b === e);
                      return (
                        <li key={`${e.ref}-${i}`} className={`evt evt--${e.type}${late ? ' evt--clash' : ''}`}>
                          <span className="evt__time">{e.debut ? <>{e.debut}{e.fin && <small>{e.fin}</small>}</> : 'Journée'}</span>
                          <span className="evt__main">
                            <span className="evt__title">
                              <T.icon size={16} aria-label={T.label} /> {e.objet || T.label}
                            </span>
                            <span className="evt__meta">
                              {[e.client, e.lieu].filter(Boolean).join(' · ')}
                              {e.lieu && <MapPin size={12} aria-hidden="true" className="evt__pin" />}
                            </span>
                            <span className="evt__meta">
                              <UserCircle size={14} /> {e.intervenants.length ? e.intervenants.join(', ') : 'Non affecté'}
                              {e.statut && <span className="badge">{e.statut}</span>}
                            </span>
                          </span>
                          <button className="evt__edit" onClick={() => edit(e)} disabled={!live} aria-label={`Modifier : ${e.objet}`} title="Modifier avec l’assistante">
                            <PencilSimple size={16} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {p && p.manques.length > 0 && (
        <details className="card gaps">
          <summary>
            <Info size={18} /> Ce qu’Interfast ne permet pas de savoir ({p.manques.length})
          </summary>
          <ul>
            {p.manques.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
