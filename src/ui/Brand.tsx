/** Logo d'Envo : un carnet de devis et une étincelle (l'assistante). SVG en ligne, aucune image. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#1e3a8a" />
      <rect x="16" y="14" width="26" height="36" rx="4" fill="#ffffff" />
      <path d="M21 24h16M21 31h16M21 38h10" stroke="#1e3a8a" strokeWidth="3" strokeLinecap="round" />
      <path d="M48 30l2.6 6.4L57 39l-6.4 2.6L48 48l-2.6-6.4L39 39l6.4-2.6z" fill="#f59e0b" />
    </svg>
  );
}

export const TAGLINE = 'Votre assistant personnel';

export function Brand({ big = false }: { big?: boolean }) {
  return (
    <div className={`brand${big ? ' brand--big' : ''}`}>
      <Logo size={big ? 48 : 32} />
      <div>
        <div className="brand__name">
          Envo <span className="ver">v{__ENVO_VERSION__}</span>
        </div>
        <div className="brand__tag">{TAGLINE}</div>
      </div>
    </div>
  );
}
