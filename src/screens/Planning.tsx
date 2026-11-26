/**
 * Planning (0.8.0) — la semaine lue dans Interfast, par jour et par intervenant,
 * et l'IMPORT d'un planning fournisseur en PDF.
 *
 * - Lecture SEULE ici (server/planning.ts) : affiché tout de suite depuis la
 *   mémoire du serveur ou la copie de l'appareil, relu derrière s'il a plus de
 *   10 minutes. Rien d'inventé : ce qu'Interfast ne dit pas n'est pas montré.
 * - Modifier ou planifier passe par l'assistante (séance AssistDevis) : toute
 *   écriture dans Interfast y est validée par l'artisan.
 * - Import PDF (`ImportPanel`) : consignes → PROPOSITION (rien n'est écrit) →
 *   lignes cochées → « Valider l'import ».
 */
import {
  ArrowClockwise,
  CalendarBlank,
  CalendarPlus,
  CaretLeft,
  CaretRight,
  Clock,
  FilePdf,
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
  FileArrowUp,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { go } from '../App';
import { api, type PlanEvent, type PlanningState, type User } from '../lib/api';
import { useOffline } from '../lib/offline';
import { addDays, dayLabel, mondayOf, todayIso, weekLabel } from '../lib/planning';
import { PageHead } from '../ui/PageHead';
import { ImportPanel } from './ImportPanel';

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

export function Planning({ user, assistant, importOpen, onStart }: { user: User; assistant: boolean; importOpen: boolean; onStart(o: { text?: string }): void }) {
  const [du, setDu] = useState(() => mondayOf(todayIso()));
  const key = `envo.planning.${user.id}.${du}`;
  const [st, setSt] = useState<PlanningState | null>(() => store.get<PlanningState>(key));
  const [error, setError] = useState('');
  const [who, setWho] = useState<string>('');
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
  const days = Array.from({ length: 7 }, (_, i) => addDays(du, i));
  const events = (p?.evenements ?? []).filter((e) => !who || e.intervenants.includes(who) || (who === '—' && e.intervenants.length === 0));
  const today = todayIso();
  const live = assistant && net.online;

  const edit = (e: PlanEvent) =>
    onStart({
      text: `Dans le planning Interfast, je veux modifier : « ${e.objet} »${e.client ? ` chez ${e.client}` : ''}, le ${dayLabel(e.date)}${e.debut ? ` à ${e.debut}` : ''}${e.ref ? ` (réf. ${e.ref})` : ''}. `,
    });
  const plan = (day?: string) => onStart({ text: day ? `Je veux planifier une intervention le ${dayLabel(day)} : ` : 'Je veux planifier une intervention : ' });

  return (
    <div className="page page--planning">
      <PageHead
        icon={CalendarBlank}
        title="Planning"
        actions={
          <div className="quick">
            <button className="btn btn--outline" onClick={() => go(importOpen ? '/planning' : '/planning/import')} disabled={!live} aria-expanded={importOpen}>
              <FilePdf size={20} /> Importer un PDF
            </button>
            <button className="btn btn--primary" onClick={() => plan()} disabled={!live}>
              <CalendarPlus size={20} /> Planifier
            </button>
          </div>
        }
      >
        Lu dans Interfast. Pour planifier ou déplacer, l’assistante prépare, vous validez.
      </PageHead>

      {importOpen && <ImportPanel assistant={assistant} onImported={() => read(du)} onClose={() => go('/planning')} />}

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
        <strong className="weekbar__label">{weekLabel(du)}</strong>
        <button className="icon-btn" onClick={() => setDu(addDays(du, 7))} aria-label="Semaine suivante" title="Semaine suivante">
          <CaretRight size={20} />
        </button>
        {du !== mondayOf(today) && (
          <button className="btn btn--small btn--ghost" onClick={() => setDu(mondayOf(today))}>
            <CalendarBlank size={16} /> Cette semaine
          </button>
        )}
        <span className="weekbar__when">
          {reading ? (
            <>
              <ArrowClockwise size={14} className="spin" /> {st?.job?.status || 'Lecture d’Interfast…'}
            </>
          ) : st?.at ? (
            `Interfast · ${new Date(st.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
          ) : null}
        </span>
        {assistant && st?.configured && (
          <button className="icon-btn icon-btn--sm" onClick={() => read(du)} disabled={reading || !net.online} aria-label="Actualiser depuis Interfast" title="Actualiser depuis Interfast">
            <ArrowClockwise size={18} className={reading ? 'spin' : ''} />
          </button>
        )}
      </div>

      {p && p.intervenants.length > 0 && (
        <div className="chips" role="group" aria-label="Intervenant">
          <button className={`chip${!who ? ' is-on' : ''}`} aria-pressed={!who} onClick={() => setWho('')}>
            <Users size={16} /> Tout le monde
          </button>
          {p.intervenants.map((n) => (
            <button key={n} className={`chip${who === n ? ' is-on' : ''}`} aria-pressed={who === n} onClick={() => setWho(who === n ? '' : n)}>
              <UserCircle size={16} /> {n}
            </button>
          ))}
          {p.evenements.some((e) => e.intervenants.length === 0) && (
            <button className={`chip${who === '—' ? ' is-on' : ''}`} aria-pressed={who === '—'} onClick={() => setWho(who === '—' ? '' : '—')}>
              <UserCircle size={16} /> Non affecté
            </button>
          )}
        </div>
      )}

      {p?.resume && <p className="plan-resume">{p.resume}</p>}

      {!p && reading && (
        <div className="week" aria-busy="true">
          {days.map((d) => (
            <div key={d} className="day card day--skeleton" />
          ))}
        </div>
      )}

      {p && (
        <div className={`week${reading ? ' is-refreshing' : ''}`}>
          {days.map((d) => {
            const list = events.filter((e) => e.date === d);
            return (
              <section key={d} className={`day card${d === today ? ' day--today' : ''}`} aria-label={dayLabel(d)}>
                <h2 className="day__head">
                  <span>{dayLabel(d)}</span>
                  {list.length > 0 && <span className="badge">{list.length}</span>}
                </h2>
                {list.length === 0 ? (
                  <button className="day__empty" onClick={() => plan(d)} disabled={!live}>
                    <CalendarPlus size={16} /> Rien de planifié
                  </button>
                ) : (
                  <ul className="evts">
                    {list.map((e, i) => {
                      const T = TYPE[e.type];
                      return (
                        <li key={`${e.ref}-${i}`} className={`evt evt--${e.type}`}>
                          <span className="evt__time">
                            <Clock size={14} /> {e.debut ? `${e.debut}${e.fin ? `–${e.fin}` : ''}` : 'Journée'}
                          </span>
                          <span className="evt__title">
                            <T.icon size={16} aria-label={T.label} /> {e.objet || T.label}
                          </span>
                          {e.client && <span className="evt__sub">{e.client}</span>}
                          {e.lieu && (
                            <span className="evt__meta">
                              <MapPin size={14} /> {e.lieu}
                            </span>
                          )}
                          <span className="evt__meta">
                            <UserCircle size={14} /> {e.intervenants.length ? e.intervenants.join(', ') : 'Non affecté'}
                            {e.statut && <span className="badge">{e.statut}</span>}
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

      {!importOpen && live && st?.configured && (
        <button className="card import-cta" onClick={() => go('/planning/import')}>
          <FileArrowUp size={24} weight="light" />
          <span>
            <strong>Un planning fournisseur en PDF ?</strong>
            <span className="muted">Donnez vos consignes, Envo prépare l’import, vous validez ligne à ligne.</span>
          </span>
          <CaretRight size={18} />
        </button>
      )}
    </div>
  );
}
