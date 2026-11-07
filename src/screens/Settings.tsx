/**
 * Paramètres : entreprise et habitudes de chiffrage (lues par l'assistante à
 * chaque séance), connexion Interfast, voix, MÉMOIRE de l'assistante (le REX,
 * visible et modifiable : l'artisan voit ce qu'elle a retenu et peut le
 * corriger), sécurité du compte.
 *
 * La clé Interfast ne revient jamais du serveur : seuls ses 4 derniers caractères.
 */
import { Brain, Buildings, CheckCircle, FloppyDisk, Key, LockKey, PencilSimple, Plugs, Plus, SignOut, Trash, Warning } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type User } from '../lib/api';
import { relDate } from '../lib/format';
import { Popin } from '../ui/Popin';

interface SettingsData {
  company: string;
  trade: string;
  hourly_rate: number | null;
  vat_rate: number | null;
  margin_pct: number | null;
  travel_fee: number | null;
  validity_days: number | null;
  notes: string;
  voice_reply: boolean;
  mcp: { url: string; keyHint: string; configured: boolean };
}

interface Rex {
  id: string;
  kind: string;
  content: string;
  uses: number;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = { decision: 'Décision', preference: 'Préférence', tarif: 'Tarif', client: 'Client', methode: 'Méthode', avis: 'Votre avis' };

const nstr = (v: number | null) => (v === null || v === undefined ? '' : String(v));

function Section({ id, icon, title, intro, children, open }: { id: string; icon: ReactNode; title: string; intro?: string; children: ReactNode; open?: boolean }) {
  useEffect(() => {
    if (open) document.getElementById(`s-${id}`)?.scrollIntoView({ block: 'start' });
  }, [id, open]);
  return (
    <section className="card section" id={`s-${id}`}>
      <h2>
        {icon} {title}
      </h2>
      {intro && <p className="muted">{intro}</p>}
      {children}
    </section>
  );
}

export function Settings({ user, mail, section, onUser, onLogout }: { user: User; mail: boolean; section?: string; onUser(u: User): void; onLogout(): void }) {
  const [s, setS] = useState<SettingsData | null>(null);
  const [name, setName] = useState(user.name);
  const [form, setForm] = useState<Record<string, string>>({});
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpKey, setMcpKey] = useState('');
  const [msg, setMsg] = useState<{ where: string; ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<{ ok: boolean; error?: string; tools?: { name: string; description: string; write: boolean }[] } | null>(null);

  const load = (d: SettingsData) => {
    setS(d);
    setForm({
      company: d.company,
      trade: d.trade,
      hourly_rate: nstr(d.hourly_rate),
      vat_rate: nstr(d.vat_rate),
      margin_pct: nstr(d.margin_pct),
      travel_fee: nstr(d.travel_fee),
      validity_days: nstr(d.validity_days),
      notes: d.notes,
    });
    setMcpUrl(d.mcp.url);
  };

  useEffect(() => {
    api.get<{ settings: SettingsData }>('/api/settings').then((r) => load(r.settings), (e: Error) => setMsg({ where: 'top', ok: false, text: e.message }));
  }, []);

  const save = async (where: string, body: Record<string, unknown>) => {
    setBusy(where);
    setMsg(null);
    try {
      const r = await api.put<{ settings: SettingsData; name: string }>('/api/settings', body);
      load(r.settings);
      onUser({ ...user, name: r.name });
      setMsg({ where, ok: true, text: 'Enregistré. Pris en compte à la prochaine séance.' });
      return true;
    } catch (e) {
      setMsg({ where, ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy('');
    }
  };

  const field = (k: string, label: string, opts: { suffix?: string; numeric?: boolean; placeholder?: string } = {}) => (
    <label className="field">
      <span>{label}</span>
      <div className="field__wrap">
        <input inputMode={opts.numeric ? 'decimal' : undefined} value={form[k] ?? ''} placeholder={opts.placeholder} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        {opts.suffix && <em>{opts.suffix}</em>}
      </div>
    </label>
  );

  const note = (where: string) => msg?.where === where && <p className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</p>;

  if (!s)
    return (
      <div className="page">
        <h1>Paramètres</h1>
        {note('top') || <p className="muted">Chargement…</p>}
      </div>
    );

  return (
    <div className="page page--settings">
      <header className="page__head">
        <h1>Paramètres</h1>
        <p className="muted">Ce que l’assistante sait de vous et de votre entreprise, et la connexion à Interfast.</p>
      </header>

      <Section id="entreprise" open={section === 'entreprise'} icon={<Buildings size={20} weight="light" />} title="Mon entreprise et mes habitudes" intro="L’assistante s’en sert pour chiffrer sans vous reposer les mêmes questions.">
        <form
          className="form-grid"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void save('entreprise', { name, ...form });
          }}
        >
          <label className="field">
            <span>Votre nom</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          {field('company', 'Entreprise')}
          {field('trade', 'Métier', { placeholder: 'plombier chauffagiste, électricien…' })}
          {field('hourly_rate', 'Taux horaire', { suffix: '€ HT', numeric: true })}
          {field('vat_rate', 'TVA habituelle', { suffix: '%', numeric: true, placeholder: '10' })}
          {field('margin_pct', 'Marge sur fournitures', { suffix: '%', numeric: true })}
          {field('travel_fee', 'Frais de déplacement', { suffix: '€ HT', numeric: true })}
          {field('validity_days', 'Validité des devis', { suffix: 'jours', numeric: true, placeholder: '30' })}
          <label className="field field--wide">
            <span>Consignes pour l’assistante</span>
            <textarea rows={3} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ex. : toujours ajouter une ligne d’évacuation des gravats ; arrondir les totaux à l’euro." />
          </label>
          {note('entreprise')}
          <button className="btn btn--primary" disabled={busy === 'entreprise'}>
            <FloppyDisk size={18} /> Enregistrer
          </button>
        </form>
      </Section>

      <Section
        id="interfast"
        open={section === 'interfast'}
        icon={<Plugs size={20} weight="light" />}
        title="Connexion à Interfast"
        intro="Dans Interfast : profil → Clés API → « Ajouter une clé », puis copiez le lien du serveur MCP affiché sous la clé (offre Business). Une clé par entreprise."
      >
        <form
          className="form-grid"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (await save('interfast', { mcp_url: mcpUrl, ...(mcpKey ? { mcp_key: mcpKey } : {}) })) {
              setMcpKey('');
              setTest(null);
            }
          }}
        >
          <label className="field field--wide">
            <span>URL du serveur MCP</span>
            <input type="url" inputMode="url" value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder="https://…" autoComplete="off" spellCheck={false} />
          </label>
          <label className="field field--wide">
            <span>Clé API {s.mcp.keyHint ? `(enregistrée : ${s.mcp.keyHint})` : '(si elle n’est pas déjà dans l’URL)'}</span>
            <input type="password" value={mcpKey} onChange={(e) => setMcpKey(e.target.value)} placeholder={s.mcp.keyHint ? 'Laisser vide pour garder la clé actuelle' : 'Collez votre clé'} autoComplete="off" />
          </label>
          {note('interfast')}
          <div className="row">
            <button className="btn btn--primary" disabled={busy === 'interfast'}>
              <FloppyDisk size={18} /> Enregistrer
            </button>
            <button
              type="button"
              className="btn"
              disabled={!s.mcp.configured || busy === 'test'}
              onClick={async () => {
                setBusy('test');
                setTest(await api.post<typeof test & object>('/api/settings/test').catch((e: Error) => ({ ok: false, error: e.message })));
                setBusy('');
              }}
            >
              <Plugs size={18} /> {busy === 'test' ? 'Test en cours…' : 'Tester la connexion'}
            </button>
            {s.mcp.keyHint && (
              <button type="button" className="link-btn" onClick={() => save('interfast', { mcp_key_clear: true })}>
                Retirer la clé
              </button>
            )}
          </div>
        </form>
        {test && !test.ok && (
          <p className="alert alert--error">
            <Warning size={16} /> {test.error}
          </p>
        )}
        {test?.ok && (
          <div className="tools">
            <p className="alert alert--ok">
              <CheckCircle size={16} /> Connecté : {test.tools?.length ?? 0} outils disponibles pour l’assistante.
            </p>
            <ul>
              {test.tools?.map((t) => (
                <li key={t.name}>
                  <span className={`badge ${t.write ? 'badge--warn' : 'badge--ok'}`}>{t.write ? 'Modifie · validé par vous' : 'Lecture'}</span>
                  <code>{t.name}</code> <span className="muted">{t.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Memory open={section === 'memoire'} />

      <Security mail={mail} open={section === 'securite'} />

      <section className="card section">
        <button className="btn" onClick={onLogout}>
          <SignOut size={18} /> Se déconnecter
        </button>
        <p className="fine">Envo v{__ENVO_VERSION__} · {user.email}</p>
      </section>
    </div>
  );
}

function Memory({ open }: { open: boolean }) {
  const [rex, setRex] = useState<Rex[] | null>(null);
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [toDelete, setToDelete] = useState<Rex | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<{ rex: Rex[] }>('/api/rex').then((r) => setRex(r.rex), (e: Error) => setError(e.message));
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!adding.trim()) return;
    try {
      const r = await api.post<{ rex: Rex }>('/api/rex', { kind: 'preference', content: adding });
      setRex((l) => [r.rex, ...(l ?? [])]);
      setAdding('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Section id="memoire" open={open} icon={<Brain size={20} weight="light" />} title="Mémoire de l’assistante" intro="Ce qu’elle a retenu de vos séances (tarifs, habitudes, décisions) et vos avis. Elle s’en sert à chaque nouveau devis. Corrigez ou supprimez ce qui n’est plus vrai.">
      <form className="row" onSubmit={add}>
        <input className="grow" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Ajouter une règle : « Je facture le déplacement 35 € HT au-delà de 20 km »" aria-label="Nouvelle règle" />
        <button className="btn btn--primary" disabled={!adding.trim()}>
          <Plus size={18} /> Ajouter
        </button>
      </form>
      {error && <p className="alert alert--error">{error}</p>}
      {rex && rex.length === 0 && <p className="muted">Rien encore : l’assistante retiendra vos décisions au fil des devis.</p>}
      <ul className="rex">
        {rex?.map((r) => (
          <li key={r.id}>
            <span className={`badge badge--k-${r.kind}`}>{KIND_LABEL[r.kind] ?? r.kind}</span>
            {editing?.id === r.id ? (
              <form
                className="row grow"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await api.patch(`/api/rex/${r.id}`, { content: editing.text }).catch((err: Error) => setError(err.message));
                  setRex((l) => l?.map((x) => (x.id === r.id ? { ...x, content: editing.text } : x)) ?? null);
                  setEditing(null);
                }}
              >
                <input className="grow" value={editing.text} onChange={(e) => setEditing({ id: r.id, text: e.target.value })} autoFocus aria-label="Modifier" />
                <button className="btn btn--small btn--primary">OK</button>
              </form>
            ) : (
              <span className="grow">
                {r.content}
                <small className="muted"> · {relDate(r.created_at)}{r.uses ? ` · utilisé ${r.uses} fois` : ''}</small>
              </span>
            )}
            <button className="icon-btn" aria-label="Modifier" onClick={() => setEditing({ id: r.id, text: r.content })}>
              <PencilSimple size={18} />
            </button>
            <button className="icon-btn" aria-label="Supprimer" onClick={() => setToDelete(r)}>
              <Trash size={18} />
            </button>
          </li>
        ))}
      </ul>
      {toDelete && (
        <Popin
          tone="danger"
          icon={<Trash size={22} />}
          title="Oublier cet élément ?"
          confirmLabel="Oublier"
          cancelLabel="Garder"
          onCancel={() => setToDelete(null)}
          onConfirm={async () => {
            await api.del(`/api/rex/${toDelete.id}`).catch((e: Error) => setError(e.message));
            setRex((l) => l?.filter((x) => x.id !== toDelete.id) ?? null);
            setToDelete(null);
          }}
        >
          <p>« {toDelete.content} » ne sera plus rappelé à l’assistante.</p>
        </Popin>
      )}
    </Section>
  );
}

function Security({ mail, open }: { mail: boolean; open: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section id="securite" open={open} icon={<LockKey size={20} weight="light" />} title="Sécurité du compte" intro="Chaque connexion demande votre mot de passe puis un code reçu par e-mail. Changer le mot de passe déconnecte vos autres appareils.">
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await api.post('/api/account/password', { current, password: next });
            setMsg({ ok: true, text: `Mot de passe changé.${mail ? ' Une alerte de sécurité vous a été envoyée par e-mail.' : ''}` });
            setCurrent('');
            setNext('');
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Mot de passe actuel</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          <span>Nouveau mot de passe (8 caractères au moins)</span>
          <input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        {msg && <p className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</p>}
        <button className="btn btn--primary" disabled={busy}>
          <Key size={18} /> Changer le mot de passe
        </button>
      </form>
      <p className="fine">Envo ne vous demandera jamais votre mot de passe par e-mail.</p>
    </Section>
  );
}
