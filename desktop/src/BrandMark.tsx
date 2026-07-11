// Mark de marca (fuente de verdad, in-app). Orquestación: un "router" (chip líder con su barra de
// control) enlazado a tres "workers". Misma topología que el icono de app (chip-rack), pero en OUTLINE
// monocromo → se tiñe con currentColor y se lee sobre cualquier tema (dark / light / hc). Sin glow.
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      {/* enlaces router → workers (tronco + tres ramas) */}
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.7">
        <path d="M12 16H16.5" />
        <path d="M16.5 7V25" />
        <path d="M16.5 7H21M16.5 16H21M16.5 25H21" />
      </g>
      {/* router (líder): chip con barra de control */}
      <rect x="3.2" y="11" width="8.8" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <rect x="5.4" y="14" width="4.4" height="1.5" rx="0.4" fill="currentColor" />
      <rect x="5.4" y="16.6" width="4.4" height="1.5" rx="0.4" fill="currentColor" />
      {/* workers */}
      <g stroke="currentColor" strokeWidth="1.6">
        <rect x="21" y="3.6" width="7.4" height="6.8" rx="1.3" />
        <rect x="21" y="12.6" width="7.4" height="6.8" rx="1.3" />
        <rect x="21" y="21.6" width="7.4" height="6.8" rx="1.3" />
      </g>
    </svg>
  );
}
