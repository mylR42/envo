/**
 * Tableau de bord — l'ESSENTIEL D'ABORD (demande du 09/11/2026 : « voir tout de
 * suite l'essentiel », « le pavé du haut prend beaucoup de place alors que les
 * devis sont dans le menu »).
 *
 *  1. Bonjour + la phrase du jour + actions compactes (dicter, nouveau devis).
 *  2. À TRAITER : relances, impayés, séances qui m'attendent — gros, cliquables.
 *  3. Indicateurs (6 tuiles, une rangée sur grand écran).
 *  4. Évolution : graphiques OU tableaux (bascule mémorisée sur l'appareil).
 *  5. Listes : relances, impayés, derniers devis, à venir.
 *  6. Connexion Interfast et activité d'Envo.
 *
 * Vitesse : le dernier tableau est affiché TOUT DE SUITE (mémoire du serveur,
 * sinon copie sur l'appareil), puis rafraîchi derrière s'il a plus de 30 min —
 * l'écran garde ses chiffres pendant la lecture, sans rien qui saute.
 * Les données viennent d'Interfast en LECTURE SEULE (server/overview.ts) ; un
 * chiffre non fourni est un tiret, jamais un zéro.
 */
import {
  ArrowClockwise,
  ArrowRight,
  Brain,
  CalendarBlank,
  CaretDown,
  CaretRight,
  CaretUp,
  ChartBar,
  ChartPieSlice,
  ChatCircleDots,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  FileText,
  HandWaving,
  Hourglass,
  Info,
  Lightning,
  Microphone,
  PaperPlaneTilt,
  Plugs,
  PlugsConnected,
  Plus,
  Receipt,
  Sparkle,
  SpeakerHigh,
  Star,
  Stop,
  Table,
  TrendUp,
  Warning,
  WarningCircle,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type ConvSummary, type InterfastStatus, type Kpi, type Overview, type ReadJob, type User } from '../lib/api';
import { euros, relDate, STATUS_LABEL, toolLabel } from '../lib/format';
import { canListen, canSpeak, speak, stopSpeaking } from '../lib/voice';
import { BarList, ChartCard, ColumnChart, DataTable, fullEuros, SegmentBar, type Row } from '../ui/Charts';
import { PageHead } from '../ui/PageHead';
import { groupPipeline, statusFamily } from '../lib/status';

interface Dash {
  sessions_month: number;
  quotes_month: number;
  waiting: number;
  avg_rating: number | null;
  rex: number;
  interfast: { configured: boolean };
  assistant: boolean;
  profile_complete: boolean;
  recent: ConvSummary[];
}
type OvState = { overview: Overview | null; at: string | null; stale?: boolean; collecting?: boolean };

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
      /* navigation privée : pas de copie locale */
    }
  },
};

const hello = (name: string) => {
  const h = new Date().getHours();
  const first = name.split(' ')[0] || '';
  const f = first ? ` ${first.charAt(0).toUpperCase()}${first.slice(1).toLowerCase()}` : '';
  return `${h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour'}${f}`;
};

const KPI_ICON: Record<string, typeof FileText> = {
  devis_en_attente: Hourglass,
  montant_devis_en_attente: FileText,
  devis_acceptes_mois: CheckCircle,
  taux_transformation: TrendUp,
  ca_facture_mois: Receipt,
  factures_impayees: WarningCircle,
};

/** Indicateur à l'euro près : les centimes n'aident pas à lire un tableau de bord. */
function kpiValue(k: Kpi): string {
  if (k.valeur === null) return '–';
  if (k.unite === 'eur') return fullEuros(k.valeur);
  if (k.unite === 'pourcent') return `${k.valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %`;
  return k.valeur.toLocaleString('fr-FR');
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthShort = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;
const monthLong = (m: string) => new Date(`${m}-15`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
};
const ms = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v < 1000 ? `${v} ms` : `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`);
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Couleur d'un statut de devis : FIXE par statut (jamais par rang), 4 au plus. */
/** Couleur d'un statut : par FAMILLE (lib/status.ts), jamais par rang, jamais partagée. */
const statusSlot = (s: string) => statusFamily(s).slot;

/**
 * Le point du jour, écrit par l'assistante : replié sur deux lignes (il peut
 * en faire sept sur un téléphone et repoussait l'essentiel hors de l'écran,
 * signalé le 09/11/2026), « Lire la suite » et « Écouter ».
 */
function DailyBrief({ text, at }: { text: string; at: string | null }) {
  const [open, setOpen] = useState(false);
  const [talking, setTalking] = useState(false);
  useEffect(() => () => stopSpeaking(), []);
  const long = text.length > 140;
  return (
    <section className={`brief card${open ? ' is-open' : ''}`} aria-label="Le point du jour">
      <span className="brief__icon" aria-hidden="true">
        <Sparkle size={20} />
      </span>
      <div className="brief__body">
        <span className="brief__label">
          Le point du jour{at && <> · {new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
        </span>
        <p className="brief__text">{text}</p>
        <div className="brief__actions">
          {long && (
            <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? (
                <>
                  <CaretUp size={14} /> Réduire
                </>
              ) : (
                <>
                  <CaretDown size={14} /> Lire la suite
                </>
              )}
            </button>
          )}
          {canSpeak() && (
            <button
              className="link-btn"
              aria-pressed={talking}
              onClick={() => {
                if (talking) {
                  stopSpeaking();
                  setTalking(false);
                } else {
                  setTalking(true);
                  speak(text, () => setTalking(false));
                }
              }}
            >
              {talking ? (
                <>
                  <Stop size={14} weight="bold" /> Arrêter
                </>
              ) : (
                <>
                  <SpeakerHigh size={14} /> Écouter
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

const secs = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`;

/**
 * Progression d'une lecture d'Interfast : barre (estimée d'après la lecture
 * précédente, jamais 100 % avant la fin), puis les étapes réelles — chaque
 * appel Interfast avec sa durée, puis le calcul par l'assistante.
 */
function Step({ n, state, label, extra, time, children }: { n: number; state: 'todo' | 'on' | 'done'; label: string; extra?: string; time?: string; children?: ReactNode }) {
  return (
    <li className={state === 'todo' ? '' : `is-${state}`}>
      <span className="readprog__dot" aria-hidden="true">
        {state === 'done' ? <CheckCircle size={18} weight="bold" /> : state === 'on' ? <span className="spinner" /> : <span className="readprog__num">{n}</span>}
      </span>
      <span>
        {label} {extra && <span className="muted">{extra}</span>}
        {time && <span className="muted"> · {time}</span>}
        {children}
      </span>
    </li>
  );
}

function ReadProgress({ job, compact }: { job: ReadJob; compact: boolean }) {
  // Une horloge locale fait avancer la barre entre deux nouvelles du serveur.
  const [tick, setTick] = useState(0);
  const base = useRef({ at: Date.now(), elapsed: job.elapsedMs });
  useEffect(() => {
    base.current = { at: Date.now(), elapsed: job.elapsedMs };
  }, [job.elapsedMs]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);
  void tick;
  const elapsed = base.current.elapsed + (Date.now() - base.current.at);
  const est = job.estimateMs;
  const pct = est ? Math.min(95, (elapsed / est) * 100) : null;
  const done = job.calls.filter((c) => c.state !== 'en_cours').length;
  const calc = job.phase === 'calcul';
  // Première lecture : l'assistante choisit d'abord QUOI lire (aucun appel encore).
  const preparing = calc && job.calls.length === 0;
  const reading = job.calls.some((c) => c.state === 'en_cours');
  const readDone = job.calls.length > 0 && !reading;
  const computing = calc && job.calls.length > 0 && !reading;
  return (
    <section className={`readprog card${compact ? ' readprog--compact' : ''}`} aria-live="polite" aria-label="Lecture d’Interfast en cours">
      <div className="readprog__top">
        <strong>{preparing ? 'L’assistante prépare la lecture d’Interfast…' : computing ? 'L’assistante calcule vos indicateurs…' : 'Lecture d’Interfast…'}</strong>
        <span className="muted">
          {secs(elapsed)}
          {est ? ` / ≈ ${secs(est)}` : ''}
        </span>
      </div>
      <div className={`readprog__bar${pct === null ? ' is-indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : Math.round(pct)}>
        <span style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      {!compact && (
        <ol className="readprog__steps">
          {/* Sans lectures mémorisées, l'assistante choisit d'abord quoi lire : une étape de plus, en tête. */}
          {(preparing || job.estimateMs === null) && (
            <Step n={1} state={preparing ? 'on' : 'done'} label="Choix des lectures à faire" time={preparing ? secs(job.calcMs) : undefined} />
          )}
          <Step n={preparing || job.estimateMs === null ? 2 : 1} state={readDone ? 'done' : reading ? 'on' : 'todo'} label="Lecture d’Interfast" extra={job.calls.length ? `${done}/${job.calls.length}` : undefined}>
            {job.calls.length > 0 && (
              <ul className="readprog__calls">
                {job.calls.map((c) => (
                  <li key={c.id} className={`is-${c.state}`}>
                    {c.state === 'en_cours' ? <span className="spinner spinner--sm" /> : c.state === 'ok' ? <CheckCircle size={14} /> : <WarningCircle size={14} />}
                    {toolLabel(c.label)}
                    {c.ms !== undefined && <span className="muted"> · {(c.ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s</span>}
                  </li>
                ))}
              </ul>
            )}
          </Step>
          <Step n={preparing || job.estimateMs === null ? 3 : 2} state={computing ? 'on' : 'todo'} label="Calcul des indicateurs et des graphiques" time={computing ? secs(job.calcMs) : undefined} />
        </ol>
      )}
      {compact && (
        <p className="readprog__line muted">
          {computing ? `Interfast lu (${done} lecture${done > 1 ? 's' : ''}) · calcul ${secs(job.calcMs)}` : preparing ? 'Choix des lectures' : `Interfast : ${done}/${job.calls.length || '…'}`} · les chiffres affichés restent ceux de la dernière lecture.
        </p>
      )}
    </section>
  );
}

function Priority({ tone, icon, value, label, href, onClick }: { tone: 'warn' | 'late' | 'info'; icon: ReactNode; value: string; label: string; href?: string; onClick?(): void }) {
  const inner = (
    <>
      <span className="prio__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="prio__text">
        <strong>{value}</strong>
        <span>{label}</span>
      </span>
      <CaretRight size={18} className="prio__go" aria-hidden="true" />
    </>
  );
  return href ? (
    <a className={`prio prio--${tone}`} href={href}>
      {inner}
    </a>
  ) : (
    <button className={`prio prio--${tone}`} onClick={onClick}>
      {inner}
    </button>
  );
}

export function Dashboard({ user, assistant, onStart }: { user: User; assistant: boolean; onStart(o?: { text?: string; voice?: boolean }): void }) {
  const cacheKey = `envo.tdb.${user.id}`;
  const [d, setD] = useState<Dash | null>(null);
  const [status, setStatus] = useState<InterfastStatus | null>(null);
  const [ov, setOv] = useState<OvState | null>(() => {
    const c = store.get<OvState>(cacheKey);
    return c?.overview ? { ...c, stale: true } : null;
  });
  const [job, setJob] = useState<ReadJob | null>(null);
  const pollId = useRef(0);
  const collecting = job?.state === 'en_cours';
  const [ovError, setOvError] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState<'graph' | 'table'>(() => (store.get<string>('envo.vue') === 'table' ? 'table' : 'graph'));
  const started = useRef(false);

  /**
   * Suit la lecture d'Interfast, qui tourne sur le serveur : une question par
   * seconde. Une coupure de réseau ne perd rien (la lecture continue, le suivi
   * reprend à la question suivante) ; on n'abandonne qu'après 30 s sans réponse.
   */
  const follow = useCallback(async () => {
    const mine = ++pollId.current;
    let misses = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      if (mine !== pollId.current) return;
      try {
        const p = await api.get<{ job: ReadJob | null; overview: Overview | null; at: string | null }>('/api/interfast/overview/progress');
        misses = 0;
        setJob(p.job);
        if (!p.job || p.job.state === 'en_cours') continue;
        if (p.job.state === 'fini' && p.overview) {
          const next = { overview: p.overview, at: p.at, stale: false };
          setOv(next);
          store.set(cacheKey, next);
          api.get<InterfastStatus>('/api/interfast/status').then(setStatus, () => {});
        } else if (p.job.state === 'erreur') setOvError(p.job.error ?? 'La lecture d’Interfast n’a pas abouti.');
        setJob(null);
        return;
      } catch {
        if (++misses >= 30) {
          setOvError('Plus de nouvelles du serveur. Vérifiez la connexion, puis « Actualiser ».');
          setJob(null);
          return;
        }
      }
    }
  }, [cacheKey]);

  const collect = useCallback(async () => {
    setOvError('');
    try {
      const r = await api.post<{ job: ReadJob }>('/api/interfast/overview');
      setJob(r.job);
      void follow();
    } catch (e) {
      setOvError((e as Error).message);
    }
  }, [follow]);
  useEffect(() => () => void pollId.current++, []);

  useEffect(() => {
    api.get<Dash>('/api/dashboard').then(setD, (e: Error) => setError(e.message));
    const st = api.get<InterfastStatus>('/api/interfast/status').then(
      (s) => (setStatus(s), s),
      () => null,
    );
    const o = api.get<OvState>('/api/interfast/overview').then(
      (r) => {
        if (r.overview) {
          setOv(r);
          store.set(cacheKey, r);
        }
        return r;
      },
      () => null,
    );
    // Rien en mémoire, ou plus de 30 min : la lecture part toute seule, l'écran garde ce qu'il montre.
    void Promise.all([st, o]).then(([s, r]) => {
      if (started.current || !assistant || !s?.ok || !r) return;
      started.current = true;
      // Une lecture tourne déjà (autre onglet, page rechargée) : on reprend son suivi.
      if (r.collecting) void follow();
      else if (!r.overview || r.stale) void collect();
    });
  }, [assistant, collect, follow, cacheKey]);

  const switchView = (v: 'graph' | 'table') => {
    setView(v);
    store.set('envo.vue', v);
  };

  const relancer = (q: Overview['devis_a_relancer'][number]) =>
    onStart({ text: `Aide-moi à relancer le devis ${q.ref} de ${q.client} (${q.objet}${q.montant_ht !== null ? `, ${q.montant_ht} € HT` : ''}), envoyé il y a ${q.jours ?? '?'} jours : propose-moi un message de relance.` });
  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const o = ov?.overview ?? null;
  const connected = status?.ok === true;
  const kpi = (k: string) => o?.kpis.find((x) => x.cle === k) ?? null;
  const toFollow = o?.devis_a_relancer ?? [];
  const unpaid = kpi('factures_impayees');
  const missingProfile = d && !d.profile_complete;

  /* Séries des graphiques */
  const sr = o?.series;
  const caRows: Row[] = (sr?.ca_mensuel ?? []).map((m) => ({ label: monthShort(m.mois), full: monthLong(m.mois), values: { ca: m.montant_ht } }));
  const devisRows: Row[] = (sr?.devis_mensuels ?? []).map((m) => ({ label: monthShort(m.mois), full: monthLong(m.mois), values: { acceptes: m.acceptes, en_attente: m.en_attente, refuses: m.refuses } }));
  const devisSeries = [
    { key: 'acceptes', label: 'Acceptés', slot: 3 as const },
    { key: 'en_attente', label: 'En attente', slot: 1 as const },
    { key: 'refuses', label: 'Refusés', slot: 2 as const },
  ];
  const pipe = groupPipeline(sr?.pipeline ?? []);
  const ageRows: Row[] = (sr?.impayes_anciennete ?? []).map((t) => ({ label: t.tranche, values: { montant: t.montant_ttc, nombre: t.nombre } }));
  const allNull = (rows: Row[]) => rows.length === 0 || rows.every((r) => Object.values(r.values).every((v) => v === null));

  return (
    <div className="page page--dash">
      <PageHead
        icon={HandWaving}
        title={hello(user.name)}
        actions={
          <div className="quick">
            {canListen() && (
              <button className="btn btn--accent" onClick={() => onStart({ voice: true })} disabled={!assistant}>
                <Microphone size={20} /> Dicter un devis
              </button>
            )}
            <button className="btn btn--primary" onClick={() => onStart()} disabled={!assistant}>
              <Plus size={20} /> Nouveau devis
            </button>
          </div>
        }
      >
        Que prépare-t-on aujourd’hui ?
      </PageHead>

      {o?.resume && <DailyBrief text={o.resume} at={ov?.at ?? null} />}

      {error && <p className="alert alert--error">{error}</p>}
      {d && !d.assistant && <p className="alert alert--warn">L’assistante n’est pas activée sur le serveur (clé Anthropic absente).</p>}
      {d && !d.interfast.configured && (
        <a className="alert alert--info alert--link" href="#/parametres/interfast">
          <Plugs size={18} /> Connectez Interfast pour voir votre activité ici. <ArrowRight size={16} />
        </a>
      )}

      {/* ---------- À traiter ---------- */}
      {(toFollow.length > 0 || (unpaid?.valeur ?? 0) > 0 || (d?.waiting ?? 0) > 0) && (
        <section className="prios" aria-label="À traiter">
          {toFollow.length > 0 && (
            <Priority
              tone="warn"
              icon={<PaperPlaneTilt size={24} />}
              value={`${toFollow.length} devis à relancer`}
              label={`${fullEuros(sum(toFollow.map((q) => q.montant_ht)))} HT en jeu`}
              onClick={() => goTo('relances')}
            />
          )}
          {unpaid && (unpaid.valeur ?? 0) > 0 && (
            <Priority tone="late" icon={<WarningCircle size={24} />} value={`${fullEuros(unpaid.valeur)} impayés`} label={unpaid.detail || 'factures non réglées'} onClick={() => goTo('impayes')} />
          )}
          {(d?.waiting ?? 0) > 0 && <Priority tone="info" icon={<Hourglass size={24} />} value={`${d!.waiting} séance${d!.waiting > 1 ? 's' : ''} à reprendre`} label="l’assistante attend votre réponse" href="#/devis" />}
        </section>
      )}

      {/* ---------- Interfast ---------- */}
      {connected && (
        <div className={`biz${collecting && o ? ' is-refreshing' : ''}`}>
          <div className="biz__head">
            <h2>
              <ChartBar size={22} weight="light" /> Mon activité
            </h2>
            <span className="biz__when">
              {collecting ? null : ov?.at ? (
                `Interfast · ${new Date(ov.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              ) : null}
            </span>
            {assistant && (
              <button className="icon-btn icon-btn--sm" onClick={collect} disabled={collecting} aria-label="Actualiser depuis Interfast" title="Actualiser depuis Interfast">
                <ArrowClockwise size={18} className={collecting ? 'spin' : ''} />
              </button>
            )}
          </div>

          {ovError && (
            <p className="alert alert--error">
              <Warning size={16} /> {ovError}
            </p>
          )}

          {!o && !collecting && !ovError && assistant && (
            <div className="card empty">
              <ChartBar size={36} weight="light" />
              <p>Votre tableau de bord se construit en lisant Interfast.</p>
              <button className="btn btn--primary" onClick={collect}>
                <Lightning size={18} /> Lire Interfast maintenant
              </button>
            </div>
          )}
          {job && collecting && <ReadProgress job={job} compact={!!o} />}
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
                        <span className="kpi__detail">{k.detail || ' '}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ---------- Évolution ---------- */}
              <div className="section-head">
                <h2>
                  <TrendUp size={20} /> Évolution sur 6 mois
                </h2>
                <div className="segmented" role="group" aria-label="Affichage">
                  <button className={view === 'graph' ? 'is-on' : ''} aria-pressed={view === 'graph'} onClick={() => switchView('graph')}>
                    <ChartBar size={16} /> Graphiques
                  </button>
                  <button className={view === 'table' ? 'is-on' : ''} aria-pressed={view === 'table'} onClick={() => switchView('table')}>
                    <Table size={16} /> Tableaux
                  </button>
                </div>
              </div>
              <div className="charts">
                <ChartCard
                  icon={<Receipt size={18} />}
                  title="CA facturé"
                  sub="par mois, HT"
                  view={view}
                  empty={allNull(caRows) ? 'Non disponible depuis Interfast.' : null}
                  chart={<ColumnChart rows={caRows} series={[{ key: 'ca', label: 'CA facturé HT', slot: 1 }]} caption="CA facturé HT par mois" />}
                  table={<DataTable rows={caRows} cols={[{ key: 'ca', label: 'CA HT' }]} total />}
                />
                <ChartCard
                  icon={<FileText size={18} />}
                  title="Devis émis"
                  sub="montant HT par mois, selon leur statut aujourd’hui"
                  view={view}
                  empty={allNull(devisRows) ? 'Non disponible depuis Interfast.' : null}
                  chart={<ColumnChart rows={devisRows} series={devisSeries} caption="Devis émis par mois" />}
                  table={<DataTable rows={devisRows} cols={devisSeries.map((s) => ({ key: s.key, label: s.label }))} total />}
                />
                <ChartCard
                  icon={<ChartPieSlice size={18} />}
                  title="Portefeuille de devis"
                  sub="montant HT par statut"
                  view={view}
                  empty={pipe.length === 0 ? 'Non disponible depuis Interfast.' : null}
                  chart={
                    <SegmentBar
                      caption="Devis par statut"
                      parts={pipe.map((p) => ({ label: p.label, value: p.montant_ht, slot: p.slot, detail: [p.nombre !== null ? `${p.nombre} devis` : '', p.sources.length > 1 || p.key === 'autres' ? p.sources.join(', ') : ''].filter(Boolean).join(' · ') || undefined }))}
                    />
                  }
                  table={
                    <DataTable
                      rows={pipe.map((p) => ({ label: p.label, values: { nombre: p.nombre, montant: p.montant_ht } }))}
                      cols={[
                        { key: 'nombre', label: 'Nombre' },
                        { key: 'montant', label: 'Montant HT' },
                      ]}
                      format={(v) => (v === null ? '–' : v >= 1000 || !Number.isInteger(v) ? fullEuros(v) : String(v))}
                    />
                  }
                />
                <ChartCard
                  icon={<WarningCircle size={18} />}
                  title="Impayés par ancienneté"
                  sub="TTC, selon l’échéance"
                  view={view}
                  empty={allNull(ageRows) ? 'Non disponible depuis Interfast.' : null}
                  chart={<BarList rows={ageRows} valueKey="montant" caption="Impayés par ancienneté" extra={(r) => (r.values.nombre ? `${r.values.nombre} fact.` : '')} />}
                  table={
                    <DataTable
                      rows={ageRows}
                      cols={[
                        { key: 'nombre', label: 'Factures' },
                        { key: 'montant', label: 'Montant TTC' },
                      ]}
                      format={(v) => (v === null ? '–' : v >= 100 || !Number.isInteger(v) ? fullEuros(v) : String(v))}
                    />
                  }
                />
              </div>

              {/* ---------- Listes ---------- */}
              <div className="grid2">
                <section className="card" id="relances">
                  <h2>
                    <PaperPlaneTilt size={20} /> Devis à relancer
                    {toFollow.length > 0 && <span className="h2__aside">{toFollow.length}</span>}
                  </h2>
                  {toFollow.length === 0 ? (
                    <p className="muted">Aucun devis en attente depuis plus de 7 jours.</p>
                  ) : (
                    <ul className="list">
                      {toFollow.map((q) => (
                        <li key={q.ref + q.client}>
                          <button className="list__btn" onClick={() => relancer(q)} disabled={!assistant}>
                            <span className="list__icon list__icon--warn" aria-hidden="true">
                              <Hourglass size={20} />
                            </span>
                            <span className="list__body">
                              <span className="list__title">{q.client}</span>
                              <span className="list__sub">{q.objet}</span>
                              <span className="list__meta">
                                {q.ref}
                                {q.jours !== null && <span className="badge badge--warn">{q.jours} j</span>}
                              </span>
                            </span>
                            <span className="list__end">
                              <strong className="list__amount">{q.montant_ht !== null ? fullEuros(q.montant_ht) : '–'}</strong>
                              <span className="list__cta">
                                Relancer <CaretRight size={14} />
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="card" id="impayes">
                  <h2>
                    <Receipt size={20} /> Factures impayées
                    {o.factures_impayees.length > 0 && <span className="h2__aside">{o.factures_impayees.length}</span>}
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
                              {f.echeance && <> · éch. {day(f.echeance)}</>}
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
                          <span className={`list__icon list__icon--s${statusSlot(q.statut)}`} aria-hidden="true">
                            <FileText size={20} />
                          </span>
                          <span className="list__body">
                            <span className="list__title">{q.client}</span>
                            <span className="list__sub">{q.objet}</span>
                            <span className="list__meta">
                              <span className="badge">{q.statut || '?'}</span>
                              {q.date && day(q.date)}
                            </span>
                          </span>
                          <strong className="list__amount">{q.montant_ht !== null ? fullEuros(q.montant_ht) : '–'}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="card">
                  <h2>
                    <CalendarBlank size={20} /> À venir · 14 jours
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
        </div>
      )}

      {/* ---------- Connexion et Envo ---------- */}
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
              {status.lastRead && (
                <div>
                  <dt>Dernière lecture</dt>
                  <dd>
                    {secs(status.lastRead.ms)} — Interfast {secs(status.lastRead.interfast_ms)} ({status.lastRead.calls} lecture{status.lastRead.calls > 1 ? 's' : ''}), calcul {secs(status.lastRead.calcul_ms)}
                  </dd>
                </div>
              )}
              <div>
                <dt>Cette semaine</dt>
                <dd>
                  {status.week.calls} appel{status.week.calls > 1 ? 's' : ''}
                  {status.week.calls > 0 && <>, {ms(status.week.avg_ms)} en moyenne</>}
                  {status.week.errors > 0 && <span className="badge badge--late">{status.week.errors} en erreur</span>}
                </dd>
              </div>
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
              <span>
                <CheckCircle size={18} /> <strong>{d.quotes_month}</strong> devis créés ce mois
              </span>
              <span>
                <ChatCircleDots size={18} /> <strong>{d.sessions_month}</strong> séances ce mois
              </span>
              <a href="#/parametres/memoire">
                <Brain size={18} /> <strong>{d.rex}</strong> choses retenues
              </a>
              <button className="minis__btn" onClick={() => onStart({ text: 'Fais-moi le point sur mes devis en cours dans Interfast : ceux en attente de réponse, à relancer, et les plus anciens.' })} disabled={!assistant}>
                <ClipboardText size={18} /> Faire le point
              </button>
            </div>
          )}
          {missingProfile && (
            <a className="alert alert--info alert--link" href="#/parametres/entreprise">
              <Info size={16} /> Renseignez entreprise, métier et taux horaire pour des chiffrages justes. <ArrowRight size={14} />
            </a>
          )}
          {d && d.recent.length > 0 && (
            <ul className="list">
              {d.recent.slice(0, 4).map((c) => (
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
