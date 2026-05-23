type Props = { className?: string };

/**
 * BEFORE column illustration: scattered doc icons with tangled gray broken
 * lines, a confused engineer, and an AI bot with a question mark.
 */
export function ChaosScatter({ className }: Props) {
  const docs = [
    { x: 70, y: 50, label: 'Notion' },
    { x: 240, y: 38, label: 'Confluence' },
    { x: 380, y: 70, label: 'README' },
    { x: 110, y: 170, label: 'ADR' },
    { x: 300, y: 200, label: 'Slack' },
    { x: 410, y: 200, label: 'Google Doc' },
  ];

  return (
    <svg
      viewBox="0 0 500 320"
      role="img"
      aria-label="Scattered docs with tangled connections and confused engineer and AI agent"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* tangled broken lines */}
      <g
        stroke="#64748b"
        strokeOpacity="0.6"
        strokeWidth="1.5"
        strokeDasharray="4 5"
        fill="none"
      >
        <path d="M120,80 C200,140 200,30 270,70" />
        <path d="M270,70 C320,120 360,40 410,90" />
        <path d="M160,200 C220,140 280,260 340,210" />
        <path d="M120,80 C150,180 220,210 160,200" />
        <path d="M410,90 C450,160 380,260 340,210" />
        <path d="M270,70 C260,180 200,220 160,200" />
      </g>

      {/* doc tiles */}
      {docs.map((d) => (
        <DocIcon key={d.label} x={d.x} y={d.y} label={d.label} />
      ))}

      {/* Confused engineer */}
      <g transform="translate(30 240)">
        <circle cx="20" cy="10" r="9" fill="rgba(148,163,184,0.18)" stroke="#94a3b8" />
        <path
          d="M5,40 C5,28 35,28 35,40 L35,58 L5,58 Z"
          fill="rgba(148,163,184,0.18)"
          stroke="#94a3b8"
        />
        <text x="20" y="-2" textAnchor="middle" fontSize="14" fill="#94a3b8">
          ?
        </text>
        <text x="20" y="72" textAnchor="middle" fontSize="9" fill="#94a3b8">
          engineer
        </text>
      </g>

      {/* AI bot with question */}
      <g transform="translate(420 240)">
        <rect
          x="0"
          y="10"
          width="44"
          height="34"
          rx="6"
          fill="rgba(148,163,184,0.18)"
          stroke="#94a3b8"
        />
        <circle cx="14" cy="26" r="2.5" fill="#94a3b8" />
        <circle cx="30" cy="26" r="2.5" fill="#94a3b8" />
        <line x1="22" y1="0" x2="22" y2="10" stroke="#94a3b8" />
        <circle cx="22" cy="0" r="2" fill="#94a3b8" />
        <text x="60" y="32" fontSize="14" fill="#94a3b8" fontWeight="700">
          ?
        </text>
        <text x="22" y="58" textAnchor="middle" fontSize="9" fill="#94a3b8">
          AI agent
        </text>
      </g>
    </svg>
  );
}

function DocIcon({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M0,0 L34,0 L46,12 L46,52 L0,52 Z"
        fill="rgba(148,163,184,0.10)"
        stroke="#94a3b8"
        strokeOpacity="0.7"
      />
      <path d="M34,0 L34,12 L46,12" fill="none" stroke="#94a3b8" strokeOpacity="0.7" />
      <g opacity="0.7">
        <line x1="8" y1="22" x2="38" y2="22" stroke="#94a3b8" strokeWidth="1.5" />
        <line x1="8" y1="30" x2="32" y2="30" stroke="#94a3b8" strokeWidth="1.5" />
        <line x1="8" y1="38" x2="36" y2="38" stroke="#94a3b8" strokeWidth="1.5" />
      </g>
      <text x="23" y="68" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontWeight="500">
        {label}
      </text>
    </g>
  );
}
