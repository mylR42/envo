/**
 * Graphiques du tableau de bord, en SVG écrit à la main : aucune bibliothèque
 * (la CSP du site n'autorise que lui-même, et un graphe de plus de 100 ko pour
 * trois histogrammes ne vaut pas sa place sur un téléphone).
 *
 * Règles (méthode dataviz) :
 * - couleurs par RÔLE, dans un ordre fixe, palette validée par le script
 *   (`--series-1…4`, voir styles.css) ; jamais la couleur pour le texte ;
 * - barres fines (≤ 24 px), bout arrondi de 4 px, carrées sur la ligne de base,
 *   2 px d'espace entre segments empilés ;
 * - UNE échelle par graphique, graduations rondes, grille fine et discrète ;
 * - légende dès deux séries ; info-bulle au survol ET au clavier (focus) ;
 * - la vue TABLEAU porte toutes les valeurs : l'info-bulle n'est jamais la
 *   seule porte (et deux teintes sont sous 3:1 sur blanc).
 * Une valeur inconnue (null) ne dessine rien et s'écrit « – » dans le tableau.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import type { Slot } from '../lib/status';

export interface SeriesDef {
  key: string;
  label: string;
  /** Indice de couleur catégorielle, 1 à 4, fixe pour une même entité. */
  slot: Slot;
}
export interface Row {
  label: string;
  /** Libellé long (info-bulle, tableau). */
  full?: string;
  values: Record<string, number | null>;
}

/** Graduations rondes : 0, pas « propre » (1, 2, 2,5, 5 × 10ⁿ). PUR, testé. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** « 12 k€ », « 1,2 M€ », « 950 € » : pour les axes, compact et sans centimes. PUR. */
export function shortEuros(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
  if (a >= 1e4) return `${Math.round(v / 1e3).toLocaleString('fr-FR')} k€`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(v).toLocaleString('fr-FR')} €`;
}

export const fullEuros = (v: number | null) => (v === null ? '–' : `${Math.round(v).toLocaleString('fr-FR')} €`);

function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className={`legend__key fill-${s.slot}`} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

interface Tip {
  x: number;
  y: number;
  title: string;
  lines: { slot?: number; label: string; value: string }[];
}

function TipBox({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="tip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="tip__title">{tip.title}</div>
      {tip.lines.map((l) => (
        <div key={l.label} className="tip__row">
          {l.slot && <span className={`tip__key stroke-${l.slot}`} aria-hidden="true" />}
          <strong>{l.value}</strong> <span>{l.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Histogramme en colonnes, empilé quand il y a plusieurs séries. Une échelle,
 * la valeur du total écrite au-dessus de la DERNIÈRE colonne et de la plus haute
 * seulement (étiquettes sélectives).
 */
export function ColumnChart({ rows, series, format = shortEuros, caption }: { rows: Row[]; series: SeriesDef[]; format?: (v: number) => string; caption: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const totals = rows.map((r) => series.reduce((a, s) => a + (r.values[s.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1] || 1;
  const W = 320;
  const H = 168;
  const padL = 44;
  const padB = 22;
  const padT = 18;
  const plotW = W - padL - 6;
  const plotH = H - padB - padT;
  const band = plotW / Math.max(rows.length, 1);
  const bw = Math.min(24, band * 0.56);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const maxI = totals.indexOf(Math.max(...totals));
  const labelled = new Set([rows.length - 1, maxI]);

  const show = (i: number, target: SVGElement) => {
    const r = rows[i]!;
    const b = target.getBoundingClientRect();
    const host = box.current!.getBoundingClientRect();
    setTip({
      x: b.left - host.left + b.width / 2,
      y: b.top - host.top,
      title: r.full ?? r.label,
      lines: [
        ...series.map((s) => ({ slot: series.length > 1 ? s.slot : undefined, label: s.label, value: r.values[s.key] == null ? '–' : format(r.values[s.key]!) })),
        ...(series.length > 1 ? [{ label: 'Total', value: format(totals[i]!) }] : []),
      ],
    });
  };

  return (
    <div className="chart" ref={box} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption} className="chart__svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={padL - 6} y={y(t) + 3.5} className="tick" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = padL + band * i + band / 2;
          let acc = 0;
          const segs = series
            .map((s) => ({ s, v: r.values[s.key] ?? null }))
            .filter((x): x is { s: SeriesDef; v: number } => x.v !== null && x.v > 0);
          return (
            <g key={r.label}>
              {segs.map(({ s, v }, k) => {
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const last = k === segs.length - 1;
                // 2 px d'espace entre segments ; seul le dernier a le bout arrondi.
                const h = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0));
                const rad = last ? Math.min(4, h, bw / 2) : 0;
                const x0 = cx - bw / 2;
                const top = y1;
                const d = `M${x0},${top + h}V${top + rad}Q${x0},${top} ${x0 + rad},${top}H${x0 + bw - rad}Q${x0 + bw},${top} ${x0 + bw},${top + rad}V${top + h}Z`;
                return <path key={s.key} d={d} className={`fill-${s.slot}`} />;
              })}
              {/* Zone de survol plus grande que la barre, atteignable au clavier. */}
              <rect
                x={padL + band * i}
                y={padT}
                width={band}
                height={plotH}
                className="hit"
                tabIndex={0}
                aria-label={`${r.full ?? r.label} : ${format(totals[i]!)}`}
                onPointerEnter={(e) => show(i, e.currentTarget)}
                onFocus={(e) => show(i, e.currentTarget)}
                onBlur={() => setTip(null)}
              />
              {labelled.has(i) && totals[i]! > 0 && (
                <text x={cx} y={y(totals[i]!) - 5} textAnchor="middle" className="val">
                  {format(totals[i]!)}
                </text>
              )}
              <text x={cx} y={H - 6} textAnchor="middle" className="tick">
                {r.label}
              </text>
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} />
      <Legend series={series} />
    </div>
  );
}

/**
 * Barres horizontales (une série) : catégories ordonnées (ancienneté des
 * impayés). La valeur est écrite au bout de chaque barre — peu de barres, et
 * c'est le chiffre qu'on vient lire.
 */
export function BarList({ rows, valueKey, format = fullEuros, extra, caption }: { rows: Row[]; valueKey: string; format?: (v: number | null) => string; extra?: (r: Row) => string; caption: string }) {
  const max = Math.max(...rows.map((r) => r.values[valueKey] ?? 0), 0) || 1;
  return (
    <ul className="barlist" aria-label={caption}>
      {rows.map((r) => {
        const v = r.values[valueKey] ?? null;
        return (
          <li key={r.label}>
            <span className="barlist__label">{r.label}</span>
            <span className="barlist__track">
              {v !== null && v > 0 && <span className="barlist__bar fill-1" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />}
            </span>
            <span className="barlist__value">
              <strong>{format(v)}</strong>
              {extra && <small>{extra(r)}</small>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Barre segmentée haute : un tout (le portefeuille de devis) découpé en parts.
 * Part affichée en % dans le bloc quand elle a la place ; nom, montant et part
 * dans la légende et l'info-bulle.
 */
export function SegmentBar({ parts, caption }: { parts: { label: string; value: number; slot: Slot; detail?: string }[]; caption: string }) {
  const id = useId();
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return <p className="muted">Rien à afficher.</p>;
  return (
    <div className="segbar">
      <div className="segbar__bar" role="img" aria-labelledby={`${id}-l`}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const share = p.value / total;
            return (
              <span key={p.label} className={`segbar__part fill-${p.slot}`} style={{ flexGrow: share }} title={`${p.label} : ${fullEuros(p.value)} (${Math.round(share * 100)} %)`}>
                {share >= 0.12 && <span className={`segbar__pct ink-on-${p.slot}`}>{Math.round(share * 100)} %</span>}
              </span>
            );
          })}
      </div>
      <ul className="legend legend--rows" id={`${id}-l`} aria-label={caption}>
        {parts.map((p) => (
          <li key={p.label}>
            <span className={`legend__key fill-${p.slot}`} aria-hidden="true" />
            <span className="legend__name">{p.label}</span>
            <strong>{fullEuros(p.value)}</strong>
            {p.detail && <small>{p.detail}</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vue tableau d'une série de lignes : toutes les valeurs, toujours lisibles. */
export function DataTable({ rows, cols, format = fullEuros, total }: { rows: Row[]; cols: { key: string; label: string }[]; format?: (v: number | null) => string; total?: boolean }) {
  const sum = (k: string) => {
    const vals = rows.map((r) => r.values[k]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  return (
    <div className="dtable">
      <table>
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.full ?? r.label}</th>
              {cols.map((c) => (
                <td key={c.key}>{format(r.values[c.key] ?? null)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {cols.map((c) => (
                <td key={c.key}>{format(sum(c.key))}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Carte de graphique : titre + sous-titre, puis graphique OU tableau. */
export function ChartCard({ icon, title, sub, view, chart, table, empty }: { icon: ReactNode; title: string; sub?: string; view: 'graph' | 'table'; chart: ReactNode; table: ReactNode; empty?: string | null }) {
  return (
    <section className="card chartcard">
      <h3>
        {icon} {title}
      </h3>
      {sub && <p className="chartcard__sub">{sub}</p>}
      {empty ? <p className="muted chartcard__empty">{empty}</p> : view === 'graph' ? chart : table}
    </section>
  );
}
