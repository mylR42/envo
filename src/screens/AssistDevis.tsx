/**
 * AssistDevis : la conversation avec l'assistante, au clavier ou à la voix.
 *
 * Ce que l'écran montre, dans l'ordre où l'assistante le produit :
 * - ses messages, lisibles à voix haute ;
 * - ses QUESTIONS À CHOIX (boutons), auxquelles on répond d'un appui ou à la voix ;
 * - le BROUILLON du devis (tableau, totaux HT / TVA / TTC calculés ici) ;
 * - les CONSULTATIONS d'Interfast (une ligne discrète) ;
 * - les ACTIONS À VALIDER (création de devis…) : rien ne part sans « Valider » ;
 * - ce qu'elle a MÉMORISÉ.
 *
 * Mode « mains libres » : après chaque réponse lue, le micro se rouvre tout seul.
 * ⚠️ À la voix, une validation demande une formule explicite (« je valide ») :
 * un « oui » mal entendu ne crée pas de devis (`voiceDecision`).
 */
import {
  ArrowLeft,
  Brain,
  CaretRight,
  Check,
  ChatCircleDots,
  CheckCircle,
  ClipboardText,
  FlagCheckered,
  Headset,
  Hourglass,
  Spinner,
  FileText,
  MagnifyingGlass,
  Microphone,
  MicrophoneSlash,
  PaperPlaneRight,
  Plus,
  SpeakerHigh,
  SpeakerSlash,
  Stop,
  Star,
  Trash,
  Warning,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { go } from '../App';
import { api, sendTurn, type Answer, type ConvSummary, type ConvView, type ViewItem } from '../lib/api';
import { euros, fieldLabel, relDate, STATUS_LABEL, toolLabel, totals } from '../lib/format';
import { canListen, canSpeak, listen, matchOption, speak, stopSpeaking, voiceDecision, type Listening } from '../lib/voice';
import { Markdown } from '../ui/Markdown';
import { PageHead } from '../ui/PageHead';
import { Popin } from '../ui/Popin';

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* navigation privée : préférence non retenue */
    }
  },
};

export function AssistDevis(props: { id?: string; assistant: boolean; start: { text?: string; voice?: boolean } | null; onStarted(): void }) {
  if (!props.id) return <SessionList {...props} />;
  return <Conversation id={props.id} assistant={props.assistant} start={props.start} onStarted={props.onStarted} />;
}

/* ------------------------------------------------------------------ */

function SessionList({ assistant, start, onStarted }: { assistant: boolean; start: { text?: string; voice?: boolean } | null; onStarted(): void }) {
  const [list, setList] = useState<ConvSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<ConvSummary | null>(null);
  const creating = useRef(false);

  const create = async () => {
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>('/api/conversations');
      go(`/devis/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      onStarted();
    } finally {
      creating.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (start && assistant) void create();
    else api.get<{ conversations: ConvSummary[] }>('/api/conversations').then((r) => setList(r.conversations), (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois à l'ouverture
  }, []);

  const remove = async () => {
    if (!toDelete) return;
    await api.del(`/api/conversations/${toDelete.id}`).catch((e: Error) => setError(e.message));
    setList((l) => l?.filter((c) => c.id !== toDelete.id) ?? null);
    setToDelete(null);
  };

  return (
    <div className="page">
      <PageHead
        icon={ChatCircleDots}
        title="AssistDevis"
        actions={
          <button className="btn btn--primary" onClick={create} disabled={busy || !assistant}>
            <Plus size={18} /> Nouvelle séance
          </button>
        }
      >
        Vos séances avec l’assistante. Une séance en attente reprend là où vous l’avez laissée.
      </PageHead>
      {!assistant && <p className="alert alert--warn">L’assistante n’est pas activée sur le serveur (clé Anthropic absente).</p>}
      {error && <p className="alert alert--error">{error}</p>}
      {list && list.length === 0 && (
        <div className="card empty">
          <FileText size={40} weight="light" />
          <p>Aucune séance encore. Commencez par décrire un chantier : « Remplacement d’un chauffe-eau 200 litres chez M. Martin à Angers ».</p>
        </div>
      )}
      {list && list.length > 0 && (
        <ul className="list card">
          {list.map((c) => (
            <li key={c.id} className="list__row">
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
              <button className="icon-btn" aria-label="Supprimer la séance" onClick={() => setToDelete(c)}>
                <Trash size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {toDelete && (
        <Popin tone="danger" icon={<Trash size={22} />} title="Supprimer cette séance ?" confirmLabel="Supprimer" cancelLabel="Annuler" onConfirm={remove} onCancel={() => setToDelete(null)}>
          <p>
            La conversation « {toDelete.title || 'sans titre'} » sera effacée d’Envo. Ce qui a été créé dans Interfast n’est <strong>pas</strong> touché. Les habitudes mémorisées restent dans Paramètres → Mémoire.
          </p>
        </Popin>
      )}
    </div>
  );
}

/** Icône d'état d'une séance : la même partout (liste, en-tête). */
export function StatusIcon({ status, waiting }: { status: string; waiting?: boolean }) {
  if (waiting) return <Hourglass size={14} weight="bold" />;
  if (status === 'devis_cree') return <CheckCircle size={14} weight="bold" />;
  if (status === 'termine') return <FlagCheckered size={14} weight="bold" />;
  return <Spinner size={14} weight="bold" />;
}

/* ------------------------------------------------------------------ */

function Conversation({ id, assistant, start, onStarted }: { id: string; assistant: boolean; start: { text?: string; voice?: boolean } | null; onStarted(): void }) {
  const [view, setView] = useState<ConvView | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [speakOn, setSpeakOn] = useState(() => store.get('envo.voix') === '1');
  /** Index (dans view.items) du message en cours de lecture, pour son bouton « Arrêter ». */
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  const [closing, setClosing] = useState(false);
  const rec = useRef<Listening | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const handsFreeRef = useRef(false);
  handsFreeRef.current = handsFree;
  const viewRef = useRef<ConvView | null>(null);
  viewRef.current = view;

  useEffect(() => {
    api.get<ConvView>(`/api/conversations/${id}`).then(
      (v) => {
        setView(v);
        if (start) {
          onStarted();
          if (start.text) void send({ text: start.text });
          else if (start.voice) {
            setHandsFree(true);
            setSpeakOn(true);
          }
        }
      },
      (e: Error) => setError(e.message),
    );
    return () => {
      rec.current?.stop();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargement initial
  }, [id]);

  useEffect(() => {
    // Séance vide : on reste en haut, sur l'accueil (titre, micro, suggestions).
    if (view?.items.length || busy || interim) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [view, status, interim, busy]);

  useEffect(() => store.set('envo.voix', speakOn ? '1' : '0'), [speakOn]);

  const openChoice = view?.items.findLast((i): i is Extract<ViewItem, { type: 'choice' }> => i.type === 'choice' && i.open) ?? null;
  const openConfirm = view?.items.find((i): i is Extract<ViewItem, { type: 'confirm' }> => i.type === 'confirm' && i.state === 'attente') ?? null;

  async function send(body: { text?: string; answers?: Answer[] }) {
    if (busy) return;
    stopSpeaking();
    setBusy(true);
    setError('');
    setStatus('Envoi…');
    const before = viewRef.current?.items.length ?? 0;
    try {
      const v = await sendTurn(id, body, setStatus);
      setView(v);
      setText('');
      if (v.mcpNote) setError(`Interfast : ${v.mcpNote}`);
      const fresh = v.items.slice(before);
      const toSay = fresh
        .map((i) => (i.type === 'assistant' ? i.text : i.type === 'choice' && i.open ? `${i.question} ${i.options.join(', ')} ?` : i.type === 'confirm' && i.state === 'attente' ? 'Je vous demande de valider cette action. Dites « je valide » ou « non ».' : ''))
        .filter(Boolean)
        .join('\n');
      const lastBot = v.items.map((it, k) => (it.type === 'assistant' ? k : -1)).filter((k) => k >= before).pop() ?? null;
      if (speakOn && toSay) say(toSay, lastBot, () => handsFreeRef.current && startListening());
      else if (handsFreeRef.current) startListening();
    } catch (e) {
      setError((e as Error).message);
      // La séance a pu avancer côté serveur malgré l'erreur d'affichage : on la relit.
      api.get<ConvView>(`/api/conversations/${id}`).then(setView, () => {});
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  /** Lit un texte ; `idx` = message dont le bouton passe à « Arrêter ». */
  function say(t: string, idx: number | null, after?: () => void) {
    setSpeaking(idx);
    speak(
      t,
      () => {
        setSpeaking((cur) => (cur === idx ? null : cur));
        after?.();
      },
      (e) =>
        setError(
          e === 'bloque'
            ? 'Le navigateur a bloqué la lecture. Touchez « Écouter » sous la réponse, et vérifiez que le son de l’appareil n’est pas coupé.'
            : 'Aucune voix disponible sur cet appareil pour la lecture.',
        ),
    );
  }

  function listenTo(idx: number) {
    if (speaking === idx) {
      stopSpeaking();
      setSpeaking(null);
      return;
    }
    const it = view?.items[idx];
    if (it?.type === 'assistant') say(it.text, idx);
  }

  /** Une phrase dite : réponse à la question ouverte, décision sur l'action en attente, ou message. */
  function spoken(t: string) {
    const v = viewRef.current;
    const choice = v?.items.findLast((i): i is Extract<ViewItem, { type: 'choice' }> => i.type === 'choice' && i.open);
    const confirm = v?.items.find((i): i is Extract<ViewItem, { type: 'confirm' }> => i.type === 'confirm' && i.state === 'attente');
    if (confirm) {
      const d = voiceDecision(t);
      if (d) return void send({ answers: [{ toolUseId: confirm.id, approved: d === 'valider' }] });
    }
    if (choice) {
      const o = matchOption(t, choice.options);
      return void send({ answers: [{ toolUseId: choice.id, choice: o ?? t }] });
    }
    void send({ text: t });
  }

  function startListening() {
    if (rec.current || !canListen()) return;
    stopSpeaking();
    const r = listen({
      onInterim: setInterim,
      onFinal: (t) => {
        setInterim('');
        spoken(t);
      },
      onEnd: () => {
        rec.current = null;
        setListening(false);
        setInterim('');
      },
      onError: (m) => {
        setError(m);
        setHandsFree(false);
      },
    });
    rec.current = r;
    setListening(!!r);
  }

  const toggleMic = () => {
    if (rec.current) {
      rec.current.stop();
      setHandsFree(false);
    } else startListening();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (openChoice) void send({ answers: [{ toolUseId: openChoice.id, choice: t }] });
    else void send({ text: t });
  };

  if (error && !view) return <div className="page"><p className="alert alert--error">{error}</p><a href="#/devis" className="btn">Retour aux séances</a></div>;
  if (!view) return <div className="page" aria-busy="true"><p className="muted">Chargement de la séance…</p></div>;

  const empty = view.items.length === 0;

  return (
    <div className="chat">
      <header className="chat__head">
        <a href="#/devis" className="icon-btn" aria-label="Retour aux séances">
          <ArrowLeft size={22} />
        </a>
        <div className="chat__title">
          <strong title={view.conversation.title}>{view.conversation.title || 'Nouvelle séance'}</strong>
          <span className={`badge badge--${view.conversation.status}`}>
            <StatusIcon status={view.conversation.status} /> {STATUS_LABEL[view.conversation.status] ?? view.conversation.status}
          </span>
        </div>
        <button className="btn btn--small btn--outline" onClick={() => setClosing(true)}>
          <FlagCheckered size={18} /> Terminer
        </button>
      </header>

      {(canSpeak() || canListen()) && (
        <div className="voicebar" role="group" aria-label="Voix">
          {canSpeak() && (
            <button
              className={`toggle${speakOn ? ' is-on' : ''}`}
              onClick={() => {
                const on = !speakOn;
                setSpeakOn(on);
                stopSpeaking();
                setSpeaking(null);
                // En l'activant, on entend tout de suite la dernière réponse — ou « Lecture activée » :
                // on sait aussitôt si le son marche, et l'appui autorise la lecture dans le navigateur.
                if (on) {
                  const k = view?.items.map((it, n) => (it.type === 'assistant' ? n : -1)).filter((n) => n >= 0).pop();
                  if (k !== undefined && !busy) listenTo(k);
                  else say('Lecture activée. Je lirai mes réponses.', null);
                }
              }}
              aria-pressed={speakOn}
            >
              {speakOn ? <SpeakerHigh size={18} /> : <SpeakerSlash size={18} />} Lire les réponses
            </button>
          )}
          {canListen() && (
            <button
              className={`toggle${handsFree ? ' is-on' : ''}`}
              onClick={() => {
                const on = !handsFree;
                setHandsFree(on);
                if (on) {
                  setSpeakOn(true);
                  startListening();
                } else rec.current?.stop();
              }}
              aria-pressed={handsFree}
              title="Le micro se rouvre après chaque réponse"
            >
              <Headset size={18} /> Mains libres
            </button>
          )}
        </div>
      )}

      <div className="chat__scroll">
        {empty && (
          <div className="chat__welcome">
            <h2>Décrivez le chantier</h2>
            <p>Parlez comme à un collègue : client, adresse, travaux, quantités si vous les avez. L’assistante cherche le reste dans Interfast et vous pose les questions qui manquent.</p>
            {canListen() && (
              <button className={`mic mic--big${listening ? ' is-listening' : ''}`} onClick={toggleMic} disabled={busy || !assistant} aria-label={listening ? 'Arrêter l’écoute' : 'Appuyer et parler'}>
                {listening ? <MicrophoneSlash size={40} weight="light" /> : <Microphone size={40} weight="light" />}
                <span>{listening ? 'Je vous écoute…' : 'Appuyez et parlez'}</span>
              </button>
            )}
            <div className="chips">
              {['Remplacement chauffe-eau 200 L chez M. Martin', 'Rénovation salle de bain complète, 6 m²', 'Mise aux normes tableau électrique'].map((s) => (
                <button key={s} className="chip" onClick={() => send({ text: s })} disabled={busy || !assistant}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {view.items.map((it, i) => (
          <Item key={i} item={it} busy={busy} onAnswer={(a) => send({ answers: [a] })} speaking={speaking === i} onListen={canSpeak() ? () => listenTo(i) : undefined} />
        ))}

        {(busy || interim) && (
          <div className="msg msg--status" role="status">
            {interim ? (
              <>
                <Microphone size={16} /> « {interim} »
              </>
            ) : (
              <>
                <span className="dots" aria-hidden="true" /> {status}
              </>
            )}
          </div>
        )}
        {error && (
          <p className="alert alert--error">
            <Warning size={16} /> {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        {canListen() && (
          <button type="button" className={`mic${listening ? ' is-listening' : ''}`} onClick={toggleMic} disabled={busy || !assistant} aria-label={listening ? 'Arrêter l’écoute' : 'Parler'}>
            {listening ? <MicrophoneSlash size={24} /> : <Microphone size={24} />}
          </button>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(hover: hover)').matches) {
              e.preventDefault();
              submit(e as unknown as FormEvent);
            }
          }}
          rows={1}
          placeholder={openChoice ? 'Ou répondez autre chose…' : openConfirm ? 'Une correction avant de valider ?' : listening ? 'Je vous écoute…' : 'Écrivez ou appuyez sur le micro'}
          disabled={!assistant}
          aria-label="Votre message"
        />
        <button className="send" disabled={busy || !text.trim() || !assistant} aria-label="Envoyer">
          <PaperPlaneRight size={22} />
        </button>
      </form>

      {closing && <CloseSession id={id} onDone={() => go('/devis')} onCancel={() => setClosing(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Item({ item, busy, onAnswer, speaking, onListen }: { item: ViewItem; busy: boolean; onAnswer(a: Answer): void; speaking?: boolean; onListen?(): void }) {
  switch (item.type) {
    case 'user':
      return <div className="msg msg--user">{item.text}</div>;
    case 'answer':
      return <div className="msg msg--user msg--answer">{item.text}</div>;
    case 'assistant':
      return (
        <div className={`msg msg--bot${speaking ? ' is-speaking' : ''}`}>
          <Markdown text={item.text} />
          {onListen && (
            <button className="msg__listen" onClick={onListen} aria-pressed={speaking}>
              {speaking ? (
                <>
                  <Stop size={16} weight="bold" /> Arrêter
                </>
              ) : (
                <>
                  <SpeakerHigh size={16} /> Écouter
                </>
              )}
            </button>
          )}
        </div>
      );
    case 'lookup':
      return (
        <div className="trace">
          <MagnifyingGlass size={14} /> Interfast · {toolLabel(item.tool)} {item.ok === false && <span className="trace__err">— erreur</span>}
        </div>
      );
    case 'memo':
      return (
        <div className="trace trace--memo">
          <Brain size={14} /> Retenu : {item.text}
        </div>
      );
    case 'choice':
      return <Choice item={item} busy={busy} onAnswer={onAnswer} />;
    case 'draft':
      return <Draft item={item} />;
    case 'confirm':
      return <Confirm item={item} busy={busy} onAnswer={onAnswer} />;
  }
}

function Choice({ item, busy, onAnswer }: { item: Extract<ViewItem, { type: 'choice' }>; busy: boolean; onAnswer(a: Answer): void }) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <div className={`card choice${item.open ? '' : ' is-closed'}`}>
      <p className="choice__q">{item.question}</p>
      {item.open && (
        <div className="chips">
          {item.options.map((o) =>
            item.multiple ? (
              <button key={o} className={`chip${picked.includes(o) ? ' is-on' : ''}`} aria-pressed={picked.includes(o)} onClick={() => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]))} disabled={busy}>
                {o}
              </button>
            ) : (
              <button key={o} className="chip" onClick={() => onAnswer({ toolUseId: item.id, choice: o })} disabled={busy}>
                {o}
              </button>
            ),
          )}
          {item.multiple && (
            <button className="btn btn--primary btn--small" disabled={busy || !picked.length} onClick={() => onAnswer({ toolUseId: item.id, choice: picked.join(', ') })}>
              Valider le choix
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Draft({ item }: { item: Extract<ViewItem, { type: 'draft' }> }) {
  const t = totals(item.lignes);
  return (
    <div className="card draft">
      <div className="draft__head">
        <ClipboardText size={20} weight="light" />
        <div>
          <strong>{item.titre}</strong>
          <span className="muted">
            Brouillon — pas encore dans Interfast
            {item.client ? ` · ${item.client}` : ''}
            {item.chantier ? ` · ${item.chantier}` : ''}
          </span>
        </div>
      </div>
      <div className="draft__table" role="table">
        <div className="draft__row draft__row--head" role="row">
          <span role="columnheader">Désignation</span>
          <span role="columnheader">Qté</span>
          <span role="columnheader">PU HT</span>
          <span role="columnheader">Total HT</span>
        </div>
        {item.lignes.map((l, i) => (
          <div className="draft__row" role="row" key={i}>
            <span role="cell">
              {l.designation}
              {l.origine && <small className="draft__origin">{l.origine}</small>}
            </span>
            <span role="cell">
              {l.quantite}
              {l.unite ? ` ${l.unite}` : ''}
            </span>
            <span role="cell">{euros(Number(l.prix_unitaire_ht))}</span>
            <span role="cell">{euros(Number(l.quantite) * Number(l.prix_unitaire_ht))}</span>
          </div>
        ))}
      </div>
      <div className="draft__totals">
        <span>Total HT</span>
        <strong>{euros(t.ht)}</strong>
        {t.byRate.map((r) => (
          <FragmentRow key={r.rate} label={`TVA ${r.rate} %`} value={euros(r.tva)} />
        ))}
        <span>Total TTC</span>
        <strong className="draft__ttc">{euros(t.ttc)}</strong>
      </div>
      {item.remarques && <p className="muted draft__notes">{item.remarques}</p>}
    </div>
  );
}

const FragmentRow = ({ label, value }: { label: string; value: string }) => (
  <>
    <span>{label}</span>
    <span>{value}</span>
  </>
);

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const scalar = (v: unknown) => v === null || v === undefined ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/**
 * Ce qui va partir dans Interfast, LISIBLE par un artisan : une liste de lignes
 * devient un tableau, un objet une liste « libellé : valeur ». Jamais de JSON brut.
 */
function Value({ v }: { v: unknown }) {
  if (Array.isArray(v) && v.length && v.every(isPlain)) {
    // Colonnes de texte (désignation) d'abord, nombres ensuite : la ligne se lit comme un devis.
    const keys = [...new Set(v.flatMap((r) => Object.keys(r)))];
    const textual = (k: string) => v.some((r) => typeof r[k] === 'string' && Number.isNaN(Number(r[k])));
    const cols = [...keys.filter(textual), ...keys.filter((k) => !textual(k))].slice(0, 8);
    return (
      <div className="vtable">
        <table>
          <thead>
            <tr>{cols.map((c) => <th key={c}>{fieldLabel(c)}</th>)}</tr>
          </thead>
          <tbody>
            {v.map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c}>{scalar(r[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (Array.isArray(v)) return <>{v.map(scalar).join(', ') || '–'}</>;
  if (isPlain(v))
    return (
      <dl className="confirm__fields confirm__fields--nested">
        {Object.entries(v).map(([k, x]) => (
          <div key={k}>
            <dt>{fieldLabel(k)}</dt>
            <dd><Value v={x} /></dd>
          </div>
        ))}
      </dl>
    );
  return <>{scalar(v)}</>;
}

function Confirm({ item, busy, onAnswer }: { item: Extract<ViewItem, { type: 'confirm' }>; busy: boolean; onAnswer(a: Answer): void }) {
  const waiting = item.state === 'attente';
  const entries = Object.entries(item.input);
  return (
    <div className={`card confirm confirm--${item.state}`}>
      <div className="confirm__head">
        {item.state === 'validee' ? <CheckCircle size={20} /> : item.state === 'refusee' ? <XCircle size={20} /> : item.state === 'echec' ? <Warning size={20} /> : <Warning size={20} />}
        <strong>
          {waiting ? 'À valider — ' : item.state === 'validee' ? 'Fait dans Interfast — ' : item.state === 'refusee' ? 'Refusé — ' : 'Échec dans Interfast — '}
          {toolLabel(item.tool)}
        </strong>
      </div>
      {waiting && <p className="muted">Cette action modifie Interfast. Vérifiez ce qui va être envoyé :</p>}
      <dl className="confirm__fields">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>{fieldLabel(k)}</dt>
            <dd><Value v={v} /></dd>
          </div>
        ))}
      </dl>
      {waiting && (
        <div className="confirm__actions">
          <button className="btn" onClick={() => onAnswer({ toolUseId: item.id, approved: false })} disabled={busy}>
            <X size={18} /> Refuser
          </button>
          <button className="btn btn--primary" onClick={() => onAnswer({ toolUseId: item.id, approved: true })} disabled={busy}>
            <Check size={18} /> Valider
          </button>
        </div>
      )}
    </div>
  );
}

function CloseSession({ id, onDone, onCancel }: { id: string; onDone(): void; onCancel(): void }) {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    await api.post(`/api/conversations/${id}/close`, { rating: rating || undefined, feedback }).catch(() => {});
    onDone();
  };
  return (
    <Popin icon={<Star size={22} />} title="Terminer la séance" confirmLabel="Terminer" cancelLabel="Continuer la séance" busy={busy} onConfirm={confirm} onCancel={onCancel}>
      <p>Comment l’assistante vous a-t-elle aidé ? Votre avis lui sert dès la prochaine séance.</p>
      <div className="stars" role="radiogroup" aria-label="Note">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} sur 5`} className={n <= rating ? 'is-on' : ''} onClick={() => setRating(n)}>
            <Star size={28} weight={n <= rating ? 'fill' : 'regular'} />
          </button>
        ))}
      </div>
      <label className="field">
        <span>Un conseil pour la prochaine fois (facultatif)</span>
        <textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Ex. : pose moins de questions sur la TVA, c’est toujours 10 %." />
      </label>
    </Popin>
  );
}
