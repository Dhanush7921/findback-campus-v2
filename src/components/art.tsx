/** Original FindBack artwork (hand-authored SVG, no third-party assets). */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#059669" />
          <stop offset=".55" stopColor="#0d9488" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#lg-a)" />
      <circle cx="21" cy="21" r="9.5" fill="none" stroke="#fff" strokeWidth="3.4" />
      <path d="m28 28 8.5 8.5" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
      <path d="m16.8 21.3 3 3 5.6-6" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="font-display text-[1.2rem] font-extrabold tracking-tight text-ink-900">
        Find<span className="brand-text">Back</span>
      </span>
    </span>
  );
}

export function HeroArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 440" className={className} role="img" aria-label="Illustration of a backpack, keys and an ID card being returned with a verified check mark">
      <defs>
        <linearGradient id="h-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ecfdf5" /><stop offset="1" stopColor="#e0f2fe" /></linearGradient>
        <linearGradient id="h-bag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#14b8a6" /><stop offset="1" stopColor="#0f766e" /></linearGradient>
        <linearGradient id="h-pin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#10b981" /><stop offset="1" stopColor="#0ea5e9" /></linearGradient>
        <filter id="h-sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#0d9488" floodOpacity=".18" /></filter>
      </defs>
      <path d="M60 210c0-96 84-170 196-170s204 64 204 160-70 196-204 196S60 306 60 210Z" fill="url(#h-bg)" />
      <g opacity=".5" stroke="#99f6e4" strokeWidth="2" fill="none">
        <path d="M98 330c60-30 120 10 180-12s96-62 150-40" strokeDasharray="4 8" />
        <circle cx="430" cy="110" r="26" />
      </g>
      {/* backpack */}
      <g filter="url(#h-sh)" className="animate-float">
        <rect x="178" y="128" width="150" height="190" rx="40" fill="url(#h-bag)" />
        <path d="M218 128v-16a35 35 0 0 1 70 0v16" fill="none" stroke="#0f766e" strokeWidth="12" strokeLinecap="round" />
        <rect x="200" y="226" width="106" height="70" rx="18" fill="#2dd4bf" />
        <rect x="236" y="240" width="34" height="8" rx="4" fill="#ccfbf1" />
        <circle cx="253" cy="180" r="15" fill="#99f6e4" />
        <path d="m246 180 5 5 9-10" fill="none" stroke="#0f766e" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* id card */}
      <g transform="rotate(-10 120 250)" filter="url(#h-sh)">
        <rect x="70" y="214" width="112" height="74" rx="12" fill="#fff" />
        <rect x="70" y="214" width="112" height="18" rx="9" fill="#0ea5e9" opacity=".85" />
        <circle cx="98" cy="258" r="13" fill="#bae6fd" />
        <rect x="120" y="250" width="48" height="6" rx="3" fill="#cbd5e1" />
        <rect x="120" y="263" width="34" height="6" rx="3" fill="#e2e8f0" />
      </g>
      {/* keys */}
      <g transform="rotate(14 390 300)" filter="url(#h-sh)">
        <circle cx="372" cy="282" r="20" fill="none" stroke="#f59e0b" strokeWidth="8" />
        <path d="M390 292h58m-14 0v14m-14-14v10" stroke="#f59e0b" strokeWidth="8" strokeLinecap="round" />
      </g>
      {/* location pin */}
      <g filter="url(#h-sh)">
        <path d="M402 70c-22 0-38 16-38 37 0 28 38 64 38 64s38-36 38-64c0-21-16-37-38-37Z" fill="url(#h-pin)" />
        <circle cx="402" cy="106" r="12" fill="#fff" />
      </g>
      {/* sparkles */}
      <g fill="#34d399"><circle cx="140" cy="130" r="5" /><circle cx="470" cy="230" r="4" /><circle cx="330" cy="380" r="4" /></g>
      <path d="M150 96l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#7dd3fc" />
    </svg>
  );
}

export function EmptyBoxArt() {
  return (
    <svg viewBox="0 0 160 120" aria-hidden className="w-full">
      <ellipse cx="80" cy="104" rx="56" ry="8" fill="#e8eeee" />
      <path d="M36 46 80 30l44 16v44L80 106 36 90Z" fill="#ccfbf1" />
      <path d="M36 46 80 62l44-16M80 62v44" fill="none" stroke="#14b8a6" strokeWidth="3" strokeLinejoin="round" />
      <path d="M36 46 80 30l44 16" fill="none" stroke="#14b8a6" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="118" cy="26" r="12" fill="none" stroke="#0ea5e9" strokeWidth="3" />
      <path d="m127 35 8 8" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldArt() {
  return (
    <svg viewBox="0 0 160 120" aria-hidden className="w-full">
      <ellipse cx="80" cy="108" rx="44" ry="6" fill="#e8eeee" />
      <path d="M80 14 120 28v30c0 26-17 40-40 50-23-10-40-24-40-50V28Z" fill="#d1fae5" stroke="#059669" strokeWidth="3" strokeLinejoin="round" />
      <rect x="64" y="52" width="32" height="26" rx="6" fill="#059669" />
      <path d="M70 52v-6a10 10 0 0 1 20 0v6" fill="none" stroke="#059669" strokeWidth="3.5" />
      <circle cx="80" cy="64" r="3.5" fill="#fff" />
    </svg>
  );
}
