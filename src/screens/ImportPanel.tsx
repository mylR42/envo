/**
 * Import d'un planning fournisseur en PDF (0.8.0), en trois temps :
 *
 *  1. Le PDF + les CONSIGNES (au clavier ou dictées) → « Préparer la proposition ».
 *  2. La PROPOSITION : une ligne par élément, avec le chantier, l'intervenant,
 *     les doublons repérés et ce qui part à Interfast (outil + arguments). Rien
 *     n'est écrit ; on coche, on décoche, on peut refaire avec d'autres consignes.
 *  3. « Valider l'import » : le serveur crée les lignes cochées, avec les
 *     arguments EXACTS montrés ici (gardés en base, jamais renvoyés par l'écran),
 *     et dit ligne à ligne ce qui a réussi.
 *
 * La préparation et l'import tournent sur le serveur : l'écran suit, et une
 * page rechargée reprend où elle en était (`envo.import.courant`).
 */
import {
  ArrowCounterClockwise,
  CheckCircle,
  CheckSquare,
  Copy,
  FilePdf,
  ListChecks,
  Microphone,
  Stop,
  Spinner,
  Trash,
  UploadSimple,
  Warning,
  X,
  XCircle,
  ClockCounterClockwise,
  Info,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ImportSummary, type ImportView } from '../lib/api';
import { fieldLabel, relDate, toolLabel } from '../lib/format';
import { dayLabel } from '../lib/planning';
import { canListen, listen, type Listening } from '../lib/voice';
import { useOffline } from '../lib/offline';

const PDF_MAX = 8 * 1024 * 1024;
const CUR = 'envo.import.courant';
const LAST_RULES = 'envo.import.consignes';

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* navigation privée */
    }
  },
};

const STATE_LABEL: Record<ImportView['state'], string> = {
  preparation: 'En préparation',
  proposee: 'À valider',
  import_en_cours: 'Import en cours',
  importee: 'Importé',
  partielle: 'Importé en partie',
  echec: 'Échec',
  abandonnee: 'Abandonné',
  erreur: 'Erreur',
};

const readAsDataUrl = (f: File) =>
  new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ko(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(f);
  });

/** Lignes cochées d'office : importables et pas déjà dans Interfast. */
const defaultPick = (v: ImportView) => new Set((v.proposal?.lignes ?? []).flatMap((l, i) => (l.importable && !l.doublon ? [i] : [])));

export function ImportPanel({ assistant, onImported, onClose }: { assistant: boolean; onImported(): void; onClose(): void }) {
  const [file, setFile] = useState<File | null>(null);
  const [rules, setRules] = useState(() => ls.get(LAST_RULES) ?? '');
  const [cur, setCur] = useState<ImportView | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ImportSummary[]>([]);
  const [mic, setMic] = useState<Listening | null>(null);
  const [interim, setInterim] = useState('');
  const poll = useRef(0);
  const net = useOffline();
  const live = assistant && net.online;
  const working = cur?.state === 'preparation' || cur?.state === 'import_en_cours';

  const loadHistory = useCallback(() => api.get<{ imports: ImportSummary[] }>('/api/planning/imports').then((r) => setHistory(r.imports), () => {}), []);

  const follow = useCallback(
    async (id: string) => {
      const mine = ++poll.current;
      for (let misses = 0; misses < 60; ) {
        try {
          const r = await api.get<{ import: ImportView }>(`/api/planning/imports/${id}`);
          if (mine !== poll.current) return;
          misses = 0;
          setCur((prev) => {
            // La proposition vient d'arriver : on coche d'office ce qui est importable et nouveau.
            if (r.import.state === 'proposee' && prev?.state !== 'proposee') setPicked(defaultPick(r.import));
            return r.import;
          });
          if (r.import.state !== 'preparation' && r.import.state !== 'import_en_cours') {
            if (['importee', 'partielle'].includes(r.import.state)) onImported();
            void loadHistory();
            return;
          }
        } catch (e) {
          if ((e as { status?: number }).status === 404) {
            ls.set(CUR, null);
            setCur(null);
            return;
          }
          misses++;
        }
        await new Promise((r) => setTimeout(r, 1500));
        if (mine !== poll.current) return;
      }
      setError('Plus de nouvelles du serveur. Rouvrez l’import dans un instant : le travail continue.');
    },
    [loadHistory, onImported],
  );

  useEffect(() => {
    void loadHistory();
    const id = ls.get(CUR);
    if (id) void follow(id);
    return () => {
      poll.current++;
      mic?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (id: string) => {
    setError('');
    ls.set(CUR, id);
    void follow(id);
  };

  const prepare = async () => {
    if (!file) return setError('Choisissez d’abord le PDF du fournisseur.');
    if (file.size > PDF_MAX) return setError('PDF trop lourd : 8 Mo au plus.');
    setError('');
    setBusy(true);
    try {
      const pdf = await readAsDataUrl(file);
      ls.set(LAST_RULES, rules);
      const r = await api.post<{ id: string }>('/api/planning/imports', { nom: file.name, pdf, consignes: rules });
      setCur(null);
      open(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    if (!cur) return;
    setError('');
    setBusy(true);
    try {
      await api.post(`/api/planning/imports/${cur.id}/valider`, { lignes: [...picked] });
      void follow(cur.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const abandon = async () => {
    if (cur?.state === 'proposee') await api.post(`/api/planning/imports/${cur.id}/abandonner`).catch(() => {});
    restart();
    void loadHistory();
  };

  /** Nouvelle proposition : on garde le fichier choisi et les consignes, qu'on peut retoucher. */
  const restart = () => {
    poll.current++;
    ls.set(CUR, null);
    if (cur) setRules(cur.consignes);
    setCur(null);
    setError('');
  };

  const dictate = () => {
    if (mic) return mic.stop();
    const l = listen({
      onInterim: setInterim,
      onFinal: (t) => setRules((r) => (r.trim() ? `${r.trim()} ${t}` : t)),
      onEnd: () => {
        setMic(null);
        setInterim('');
      },
      onError: (m) => setError(m),
    });
    setMic(l);
  };

  const toggle = (i: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const lines = cur?.proposal?.lignes ?? [];
  const results = new Map(cur?.results.map((r) => [r.ligne, r]) ?? []);
  const importable = lines.filter((l) => l.importable).length;

  return (
    <section className="card importer" aria-label="Importer un planning fournisseur">
      <div className="importer__head">
        <h2>
          <FilePdf size={22} /> Importer un planning fournisseur
        </h2>
        <button className="icon-btn icon-btn--sm" onClick={onClose} aria-label="Fermer l’import" title="Fermer">
          <X size={18} />
        </button>
      </div>

      {error && <p className="alert alert--error">{error}</p>}

      {/* ---------- 1. Le PDF et les consignes ---------- */}
      {!cur && (
        <div className="importer__form">
          <label className={`drop${file ? ' drop--on' : ''}`}>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError('');
              }}
            />
            {file ? <FilePdf size={28} weight="light" /> : <UploadSimple size={28} weight="light" />}
            <span>
              <strong>{file ? file.name : 'Choisir le PDF du fournisseur'}</strong>
              <span className="muted">{file ? `${(file.size / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo · toucher pour changer` : '8 Mo au plus. Il n’est pas gardé par Envo.'}</span>
            </span>
          </label>

          <label className="field">
            <span>
              <ListChecks size={16} /> Vos consignes
            </span>
            <div className="importer__rules">
              <textarea
                rows={4}
                value={interim ? `${rules} ${interim}` : rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="Ex. : ne garder que les livraisons de décembre, les affecter à Julien sur le chantier Martin, matin = 8 h – 12 h."
              />
              {canListen() && (
                <button type="button" className={`icon-btn${mic ? ' is-on' : ''}`} onClick={dictate} aria-label={mic ? 'Arrêter la dictée' : 'Dicter les consignes'} title={mic ? 'Arrêter la dictée' : 'Dicter les consignes'}>
                  {mic ? <Stop size={20} /> : <Microphone size={20} />}
                </button>
              )}
            </div>
          </label>

          <button className="btn btn--primary btn--block" onClick={prepare} disabled={!file || busy || !live}>
            {busy ? <Spinner size={20} className="spin" /> : <ListChecks size={20} />} Préparer la proposition
          </button>
          <p className="muted importer__note">
            <Info size={16} /> Rien n’est écrit dans Interfast à cette étape : vous verrez chaque ligne avant de valider.
          </p>
        </div>
      )}

      {/* ---------- 2. Préparation / import en cours ---------- */}
      {cur && working && (
        <div className="importer__wait" role="status">
          <Spinner size={22} className="spin" />
          <span>
            <strong>{cur.state === 'preparation' ? 'Envo lit le PDF et Interfast…' : 'Import dans Interfast…'}</strong>
            <span className="muted">{cur.status || 'Cela peut prendre une minute. Vous pouvez quitter l’écran : le travail continue.'}</span>
          </span>
        </div>
      )}

      {cur && cur.state === 'erreur' && (
        <div className="importer__done">
          <p className="alert alert--error">{cur.error || 'La préparation n’a pas abouti.'}</p>
          <button className="btn btn--outline" onClick={restart}>
            <ArrowCounterClockwise size={20} /> Réessayer
          </button>
        </div>
      )}

      {/* ---------- 3. La proposition ---------- */}
      {cur?.proposal && !working && cur.state !== 'erreur' && (
        <div className="proposal">
          <p className="proposal__file">
            <FilePdf size={18} /> {cur.file_name}
            {cur.proposal.fournisseur && <span className="badge">{cur.proposal.fournisseur}</span>}
            <span className={`badge ${cur.state === 'importee' ? 'badge--ok' : cur.state === 'proposee' ? 'badge--en_cours' : cur.state === 'partielle' ? 'badge--warn' : ''}`}>{STATE_LABEL[cur.state]}</span>
          </p>
          {cur.proposal.resume && <p>{cur.proposal.resume}</p>}
          {cur.consignes && (
            <p className="muted proposal__rules">
              <ListChecks size={16} /> Consignes : {cur.consignes}
            </p>
          )}

          {lines.length === 0 ? (
            <p className="alert alert--warn">Aucune ligne à importer.</p>
          ) : (
            <ul className="plines">
              {lines.map((l, i) => {
                const res = results.get(i);
                const on = picked.has(i);
                return (
                  <li key={i} className={`pline${on && cur.state === 'proposee' ? ' is-on' : ''}${!l.importable ? ' is-off' : ''}`}>
                    {cur.state === 'proposee' ? (
                      <input type="checkbox" checked={on} disabled={!l.importable} onChange={() => toggle(i)} aria-label={`Importer : ${l.objet}`} />
                    ) : res ? (
                      res.ok ? <CheckCircle size={22} className="ok" aria-label="Importée" /> : <XCircle size={22} className="ko" aria-label="Échec" />
                    ) : (
                      <span className="pline__skip" aria-label="Non importée" />
                    )}
                    <div className="pline__body">
                      <span className="pline__when">
                        {l.date ? dayLabel(l.date) : 'Sans date'}
                        {l.debut && ` · ${l.debut}${l.fin ? `–${l.fin}` : ''}`}
                      </span>
                      <strong className="pline__title">{l.objet || 'Sans objet'}</strong>
                      <span className="pline__meta">
                        {l.chantier || <em>Chantier introuvable</em>}
                        {l.intervenant && ` · ${l.intervenant}`}
                      </span>
                      <span className="pline__badges">
                        {l.doublon && (
                          <span className="badge badge--warn">
                            <Copy size={12} weight="bold" /> Déjà dans Interfast
                          </span>
                        )}
                        {!l.importable && (
                          <span className="badge">
                            <Warning size={12} weight="bold" /> Non importable
                          </span>
                        )}
                      </span>
                      {l.remarque && <span className="pline__note">{l.remarque}</span>}
                      {res && !res.ok && <span className="pline__err">{res.message}</span>}
                      {l.importable && (
                        <details className="pline__tech">
                          <summary>{cur.state === 'proposee' ? 'Ce qui sera envoyé' : 'Envoyé à Interfast'} : {toolLabel(l.outil)}</summary>
                          <dl>
                            {Object.entries(l.arguments).map(([k, v]) => (
                              <div key={k}>
                                <dt>{fieldLabel(k)}</dt>
                                <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {(cur.proposal.ignores.length > 0 || cur.proposal.manques.length > 0) && (
            <details className="gaps">
              <summary>
                <Info size={18} /> Laissé de côté ({cur.proposal.ignores.length + cur.proposal.manques.length})
              </summary>
              <ul>
                {[...cur.proposal.ignores, ...cur.proposal.manques].map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </details>
          )}

          {cur.state === 'proposee' && (
            <div className="proposal__actions">
              <button className="btn btn--primary" onClick={validate} disabled={busy || picked.size === 0 || !net.online}>
                <CheckSquare size={20} /> Valider l’import ({picked.size} ligne{picked.size > 1 ? 's' : ''})
              </button>
              <button className="btn btn--outline" onClick={restart} disabled={busy}>
                <ArrowCounterClockwise size={20} /> Refaire avec d’autres consignes
              </button>
              <button className="btn btn--ghost" onClick={abandon} disabled={busy}>
                <Trash size={20} /> Abandonner
              </button>
              {importable < lines.length && <p className="muted">{lines.length - importable} ligne(s) ne peuvent pas être importées telles quelles : voir les remarques.</p>}
            </div>
          )}
          {cur.state !== 'proposee' && (
            <div className="proposal__actions">
              {cur.state === 'importee' && <p className="alert alert--ok">Import terminé : {cur.results.filter((r) => r.ok).length} ligne(s) créée(s) dans Interfast.</p>}
              {cur.state === 'partielle' && <p className="alert alert--warn">Import en partie : {cur.results.filter((r) => r.ok).length} réussie(s), {cur.results.filter((r) => !r.ok).length} en échec.</p>}
              {cur.state === 'echec' && <p className="alert alert--error">{cur.error || 'Aucune ligne n’a pu être créée.'}</p>}
              <button className="btn btn--outline" onClick={restart}>
                <FilePdf size={20} /> Nouvel import
              </button>
            </div>
          )}
        </div>
      )}

      {!cur && history.length > 0 && (
        <details className="importer__history">
          <summary>
            <ClockCounterClockwise size={18} /> Imports précédents ({history.length})
          </summary>
          <ul className="list">
            {history.map((h) => (
              <li key={h.id}>
                <button className="list__btn" onClick={() => open(h.id)}>
                  <FilePdf size={20} />
                  <span className="list__body">
                    <span className="list__title">{h.file_name}</span>
                    <span className="list__meta">
                      {relDate(h.created_at)}
                      {h.lignes !== null && ` · ${h.lignes} ligne(s)`}
                    </span>
                  </span>
                  <span className="badge">{STATE_LABEL[h.state]}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
