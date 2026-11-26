/**
 * E-mails (menu, 26/11/2026) : la boîte Gmail de la personne, lue à la demande.
 *
 * 1. « Analyser » : l'IA trie les e-mails récents (urgent, à répondre, devis,
 *    facture, planning, info, publicité), une ligne et l'action conseillée pour
 *    chacun, et « le point e-mails » à écouter (server/mailtriage.ts).
 * 2. La liste (non lus / boîte de réception / recherche Gmail).
 * 3. Un e-mail s'ouvre sur place : le lire, l'ÉCOUTER, ou le traiter avec
 *    l'assistante (répondre, devis, rendez-vous) — l'envoi attend « Valider ».
 * 4. « Dicter » : la même chose à la voix (et « Dis Siri, Envo » sans l'appli).
 *
 * Rien n'est gardé : ni en base, ni sur l'appareil (pas de copie hors ligne
 * d'e-mails).
 */
import {
  ArrowClockwise,
  ChatCircleDots,
  Envelope,
  EnvelopeOpen,
  EnvelopeSimple,
  MagnifyingGlass,
  Microphone,
  Paperclip,
  Plugs,
  Sparkle,
  SpeakerHigh,
  Spinner,
  Stop,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { relDate } from '../lib/format';
import { useOffline } from '../lib/offline';
import { canListen, canSpeak, speak, stopSpeaking } from '../lib/voice';
import { Brief } from '../ui/Brief';
import { PageHead } from '../ui/PageHead';

interface Msg {
  id: string;
  de: string;
  objet: string;
  date: string;
  extrait: string;
  non_lu: boolean;
}
interface Full extends Msg {
  a: string;
  cc: string;
  texte: string;
  pieces_jointes: string[];
}
type Cat = 'urgent' | 'a_repondre' | 'devis' | 'facture' | 'planning' | 'info' | 'pub';
interface Triage {
  point: string;
  items: { id: string; categorie: Cat; resume: string; action: string }[];
}

/** Dans l'ordre d'importance ; couleur par catégorie, jamais partagée. */
const CATS: { key: Cat; label: string }[] = [
  { key: 'urgent', label: 'Urgent' },
  { key: 'a_repondre', label: 'À répondre' },
  { key: 'devis', label: 'Devis' },
  { key: 'facture', label: 'Facture' },
  { key: 'planning', label: 'Planning' },
  { key: 'info', label: 'Info' },
  { key: 'pub', label: 'Publicité' },
];
const catLabel = (c: Cat) => CATS.find((x) => x.key === c)?.label ?? c;
/** « Mme Leroy <leroy@…> » → « Mme Leroy ». */
const who = (de: string) => de.replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '') || de;

export function Emails({ assistant, onStart }: { assistant: boolean; onStart(o: { text?: string; voice?: boolean }): void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<'non_lus' | 'inbox'>('non_lus');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Msg[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tri, setTri] = useState<{ analyse: Triage | null; at: string | null; messages: Msg[] } | null>(null);
  const [sorting, setSorting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, Full>>({});
  const [talking, setTalking] = useState<string | null>(null);
  const net = useOffline();
  const live = assistant && net.online;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams({ max: '25' });
      if (query) p.set('q', query);
      else if (filter === 'non_lus') p.set('non_lus', '1');
      setList((await api.get<{ messages: Msg[] }>(`/api/mail/messages?${p}`)).messages);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    api.get<{ configured: boolean }>('/api/mail').then((r) => setConfigured(r.configured), () => setConfigured(null));
    api.get<{ analyse: Triage | null; at: string | null; messages: Msg[] }>('/api/mail/analyse').then(setTri, () => {});
    return () => stopSpeaking();
  }, []);
  useEffect(() => {
    if (configured) void load();
  }, [configured, load]);

  const analyse = async () => {
    setSorting(true);
    setError('');
    try {
      const r = await api.post<{ analyse: Triage; at: string; messages: Msg[] }>('/api/mail/analyse');
      setTri(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSorting(false);
    }
  };

  /** `where` : la liste où l'e-mail a été touché (« À traiter » ou la boîte) — il ne s'ouvre qu'à cet endroit. */
  const toggle = async (id: string, where: string) => {
    stopSpeaking();
    setTalking(null);
    if (open === `${where}:${id}`) return setOpen(null);
    setOpen(`${where}:${id}`);
    if (full[id]) return;
    try {
      const r = await api.get<{ message: Full }>(`/api/mail/messages/${id}`);
      setFull((f) => ({ ...f, [id]: r.message }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const listen = (m: Full) => {
    if (talking === m.id) {
      stopSpeaking();
      return setTalking(null);
    }
    setTalking(m.id);
    speak(`E-mail de ${who(m.de)}. Objet : ${m.objet}. ${m.texte}`, () => setTalking(null));
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    setOpen(null);
    setQuery(q.trim());
  };

  const byId = new Map([...(tri?.messages ?? []), ...(list ?? [])].map((m) => [m.id, m]));
  const triOf = new Map((tri?.analyse?.items ?? []).map((t) => [t.id, t]));
  const counts = CATS.map((c) => ({ ...c, n: tri?.analyse?.items.filter((i) => i.categorie === c.key).length ?? 0 })).filter((c) => c.n > 0);
  const important = (tri?.analyse?.items ?? []).filter((i) => ['urgent', 'a_repondre', 'devis', 'facture', 'planning'].includes(i.categorie));

  const row = (where: string) => (m: Msg) => {
    const t = triOf.get(m.id);
    const f = full[m.id];
    const isOpen = open === `${where}:${m.id}`;
    return (
      <li key={m.id} className={`mail${m.non_lu ? ' mail--unread' : ''}${isOpen ? ' is-open' : ''}`}>
        <button className="mail__head" onClick={() => toggle(m.id, where)} aria-expanded={isOpen}>
          {m.non_lu ? <Envelope size={20} weight="bold" aria-label="Non lu" /> : <EnvelopeOpen size={20} aria-label="Lu" />}
          <span className="mail__body">
            <span className="mail__top">
              <strong className="mail__from">{who(m.de)}</strong>
              <span className="mail__date">{relDate(m.date)}</span>
            </span>
            <span className="mail__subject">{m.objet || '(sans objet)'}</span>
            {t ? (
              <span className="mail__ai">
                <span className={`badge cat cat--${t.categorie}`}>{catLabel(t.categorie)}</span> {t.resume}
              </span>
            ) : (
              m.extrait && <span className="mail__extract">{m.extrait}</span>
            )}
          </span>
        </button>
        {isOpen && (
          <div className="mail__open">
            {!f ? (
              <p className="muted">
                <Spinner size={16} className="spin" /> Lecture…
              </p>
            ) : (
              <>
                <p className="mail__meta">
                  <strong>De :</strong> {f.de}
                  <br />
                  <strong>À :</strong> {f.a}
                  {f.cc && (
                    <>
                      <br />
                      <strong>Copie :</strong> {f.cc}
                    </>
                  )}
                </p>
                {t && (
                  <p className="mail__advice">
                    <Sparkle size={16} /> {t.action}
                  </p>
                )}
                <div className="mail__text">{f.texte || '(message vide)'}</div>
                {f.pieces_jointes.length > 0 && (
                  <p className="mail__pj">
                    <Paperclip size={16} /> {f.pieces_jointes.join(', ')}
                  </p>
                )}
                <div className="mail__actions">
                  <button
                    className="btn btn--primary"
                    disabled={!live}
                    onClick={() => onStart({ text: `Lis l’e-mail ${f.id} de ${who(f.de)} (objet « ${f.objet} ») et propose-moi quoi faire : réponse, devis ou rendez-vous.` })}
                  >
                    <ChatCircleDots size={18} /> Traiter avec l’assistante
                  </button>
                  {canSpeak() && (
                    <button className="btn" onClick={() => listen(f)} aria-pressed={talking === f.id}>
                      {talking === f.id ? <Stop size={18} /> : <SpeakerHigh size={18} />} {talking === f.id ? 'Arrêter' : 'Écouter'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="page page--emails">
      <PageHead
        icon={EnvelopeSimple}
        title="E-mails"
        actions={
          configured ? (
            <div className="quick">
              {canListen() && (
                <button className="btn btn--accent" onClick={() => onStart({ voice: true })} disabled={!live}>
                  <Microphone size={20} /> Dicter
                </button>
              )}
              <button className="btn btn--primary" onClick={analyse} disabled={!live || sorting}>
                {sorting ? <Spinner size={20} className="spin" /> : <Sparkle size={20} />} {sorting ? 'Analyse…' : 'Analyser'}
              </button>
            </div>
          ) : undefined
        }
      >
        Votre boîte Gmail, triée par l’IA. Lisez, écoutez, faites répondre l’assistante : rien ne part sans « Valider ». À la voix : « Dis Siri, Envo, ai-je des e-mails ? ».
      </PageHead>

      {configured === false && (
        <a className="alert alert--info alert--link" href="#/parametres/gmail">
          <Plugs size={18} /> Branchez votre Gmail (2 minutes) pour le retrouver ici et le piloter à la voix.
        </a>
      )}
      {error && <p className="alert alert--error">{error}</p>}

      {configured && (
        <>
          {tri?.analyse && (
            <>
              <Brief label="Le point e-mails" text={tri.analyse.point} at={tri.at} />
              {counts.length > 0 && (
                <div className="weekstats">
                  {counts.map((c) => (
                    <span key={c.key} className={`wchip cat cat--${c.key}`}>
                      {c.label} · {c.n}
                    </span>
                  ))}
                </div>
              )}
              {important.length > 0 && (
                <section className="card">
                  <h2>
                    <Sparkle size={20} /> À traiter
                  </h2>
                  <ul className="mails">{important.map((i) => byId.get(i.id)).filter((m): m is Msg => !!m).map(row('tri'))}</ul>
                </section>
              )}
            </>
          )}
          {!tri?.analyse && (
            <button className="card ai-hint" onClick={analyse} disabled={!live || sorting}>
              <Sparkle size={24} weight="light" />
              <span>
                <strong>{sorting ? 'Analyse en cours…' : 'Faire trier ma boîte par l’IA'}</strong>
                <span className="muted">Urgent, à répondre, devis, factures, planning : l’essentiel d’abord, à lire ou à écouter.</span>
              </span>
            </button>
          )}

          <section className="card">
            <div className="mails__bar">
              <div className="segmented" role="group" aria-label="Afficher">
                <button className={!query && filter === 'non_lus' ? 'is-on' : ''} aria-pressed={!query && filter === 'non_lus'} onClick={() => (setQuery(''), setQ(''), setFilter('non_lus'))}>
                  Non lus
                </button>
                <button className={!query && filter === 'inbox' ? 'is-on' : ''} aria-pressed={!query && filter === 'inbox'} onClick={() => (setQuery(''), setQ(''), setFilter('inbox'))}>
                  Réception
                </button>
              </div>
              <form className="mails__search" onSubmit={search} role="search">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher (ex. : leroy, devis)" aria-label="Chercher dans Gmail" />
                <button className="icon-btn" aria-label="Chercher">
                  <MagnifyingGlass size={18} />
                </button>
              </form>
              <button className="icon-btn icon-btn--sm" onClick={() => void load()} disabled={loading || !net.online} aria-label="Actualiser" title="Actualiser">
                <ArrowClockwise size={18} className={loading ? 'spin' : ''} />
              </button>
            </div>
            {list === null ? (
              <p className="muted">
                <Spinner size={16} className="spin" /> Lecture de Gmail…
              </p>
            ) : list.length === 0 ? (
              <p className="muted">{query ? 'Aucun e-mail ne correspond.' : filter === 'non_lus' ? 'Aucun e-mail non lu.' : 'Boîte de réception vide.'}</p>
            ) : (
              <ul className="mails">{list.map(row('boite'))}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
