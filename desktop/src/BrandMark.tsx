// Mark de marca (fuente de verdad, in-app). Gemelo del app icon del SO: un "router" (nodo líder,
// arriba) enlazado por un bus a tres "workers" (abajo). El router usa var(--router) → la señal
// azul-acero fija de la marca; los workers y el bus usan currentColor → se adaptan al tema
// (off-white en dark, tinta en light), igual que el icono. Sin glow.
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      {/* bus: router → tres workers (tronco + tres ramas) */}
      <path
        d="M16 11V17 M6.75 17H25.25 M6.75 17V21.5 M16 17V21.5 M25.25 17V21.5"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
      {/* router (líder): nodo azul-acero de marca */}
      <rect x="11.5" y="3" width="9" height="8" rx="2.2" fill="var(--router)" />
      {/* workers */}
      <rect x="3" y="21.5" width="7.5" height="7" rx="1.8" fill="currentColor" />
      <rect x="12.25" y="21.5" width="7.5" height="7" rx="1.8" fill="currentColor" />
      <rect x="21.5" y="21.5" width="7.5" height="7" rx="1.8" fill="currentColor" />
    </svg>
  );
}
