type Props = { className?: string };

/**
 * Combined diagram for "What TrueCourse does": Verified Knowledge Base →
 * contracts → Verifier engine (gears) → Drift Report.
 */
export function EngineDiagram({ className }: Props) {
  return (
    <svg
      viewBox="0 0 960 320"
      role="img"
      aria-label="Verified Knowledge Base compiles into contracts, fed into the TrueCourse verifier engine, producing a drift report"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="ed-accent" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0.4" />
        </linearGradient>
        <marker
          id="ed-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#268CF5" opacity="0.85" />
        </marker>
      </defs>

      {/* Verified Knowledge Base */}
      <g>
        <rect
          x="24"
          y="100"
          width="180"
          height="120"
          rx="14"
          fill="rgba(38,140,245,0.08)"
          stroke="#268CF5"
          strokeOpacity="0.55"
        />
        <text x="114" y="135" textAnchor="middle" fontSize="13" fill="#cbd5e1" fontWeight="600">
          Verified
        </text>
        <text x="114" y="153" textAnchor="middle" fontSize="13" fill="#cbd5e1" fontWeight="600">
          Knowledge Base
        </text>
        {/* doc rows */}
        <g opacity="0.6">
          <rect x="48" y="170" width="132" height="6" rx="3" fill="#94a3b8" />
          <rect x="48" y="184" width="100" height="6" rx="3" fill="#94a3b8" />
          <rect x="48" y="198" width="120" height="6" rx="3" fill="#94a3b8" />
        </g>
      </g>

      {/* arrow KB -> contracts */}
      <line
        x1="208"
        y1="160"
        x2="280"
        y2="160"
        stroke="url(#ed-accent)"
        strokeWidth="2"
        markerEnd="url(#ed-arrow)"
      />

      {/* Contracts stack */}
      <g>
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(${292 + i * 8} ${108 + i * 8})`}>
            <rect
              width="130"
              height="100"
              rx="10"
              fill="rgba(148,163,184,0.08)"
              stroke="rgba(148,163,184,0.5)"
            />
            <rect x="14" y="20" width="60" height="6" rx="3" fill="#94a3b8" opacity="0.8" />
            <rect x="14" y="36" width="100" height="5" rx="2.5" fill="#94a3b8" opacity="0.5" />
            <rect x="14" y="48" width="80" height="5" rx="2.5" fill="#94a3b8" opacity="0.5" />
            <rect x="14" y="60" width="92" height="5" rx="2.5" fill="#94a3b8" opacity="0.5" />
            <rect x="14" y="72" width="70" height="5" rx="2.5" fill="#94a3b8" opacity="0.5" />
          </g>
        ))}
        <text x="365" y="244" textAnchor="middle" fontSize="11" fill="#94a3b8">
          contracts
        </text>
      </g>

      {/* arrow contracts -> engine */}
      <line
        x1="450"
        y1="160"
        x2="520"
        y2="160"
        stroke="url(#ed-accent)"
        strokeWidth="2"
        markerEnd="url(#ed-arrow)"
      />

      {/* Verifier engine with gears */}
      <g>
        <rect
          x="528"
          y="84"
          width="220"
          height="152"
          rx="16"
          fill="rgba(38,140,245,0.10)"
          stroke="#268CF5"
          strokeOpacity="0.6"
        />
        <text x="638" y="112" textAnchor="middle" fontSize="13" fill="#cbd5e1" fontWeight="600">
          Verifier engine
        </text>
        {/* gear 1 */}
        <Gear cx={596} cy={172} r={22} accent />
        {/* gear 2 */}
        <Gear cx={660} cy={184} r={16} />
        {/* gear 3 */}
        <Gear cx={702} cy={158} r={14} accent />
        <text x="638" y="222" textAnchor="middle" fontSize="10" fill="#94a3b8">
          deterministic · no LLM in the loop
        </text>
      </g>

      {/* arrow engine -> drift report */}
      <line
        x1="752"
        y1="160"
        x2="820"
        y2="160"
        stroke="url(#ed-accent)"
        strokeWidth="2"
        markerEnd="url(#ed-arrow)"
      />

      {/* Drift Report */}
      <g>
        <rect
          x="828"
          y="100"
          width="110"
          height="120"
          rx="12"
          fill="rgba(245,158,11,0.08)"
          stroke="rgba(245,158,11,0.55)"
        />
        <text x="883" y="124" textAnchor="middle" fontSize="11" fill="#fbbf24" fontWeight="600">
          Drift Report
        </text>
        <g transform="translate(842 138)">
          <circle cx="6" cy="6" r="4" fill="#22c55e" />
          <rect x="18" y="3" width="58" height="6" rx="3" fill="#94a3b8" opacity="0.7" />
        </g>
        <g transform="translate(842 158)">
          <circle cx="6" cy="6" r="4" fill="#fbbf24" />
          <rect x="18" y="3" width="70" height="6" rx="3" fill="#94a3b8" opacity="0.7" />
        </g>
        <g transform="translate(842 178)">
          <circle cx="6" cy="6" r="4" fill="#fbbf24" />
          <rect x="18" y="3" width="50" height="6" rx="3" fill="#94a3b8" opacity="0.7" />
        </g>
        <g transform="translate(842 198)">
          <circle cx="6" cy="6" r="4" fill="#22c55e" />
          <rect x="18" y="3" width="62" height="6" rx="3" fill="#94a3b8" opacity="0.7" />
        </g>
      </g>
    </svg>
  );
}

function Gear({
  cx,
  cy,
  r,
  accent = false,
}: {
  cx: number;
  cy: number;
  r: number;
  accent?: boolean;
}) {
  const teeth = 8;
  const inner = r * 0.55;
  const points: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const angle = (i / (teeth * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r : r * 0.78;
    points.push(`${cx + Math.cos(angle) * rad},${cy + Math.sin(angle) * rad}`);
  }
  const stroke = accent ? '#268CF5' : '#94a3b8';
  return (
    <g>
      <polygon
        points={points.join(' ')}
        fill={accent ? 'rgba(38,140,245,0.18)' : 'rgba(148,163,184,0.12)'}
        stroke={stroke}
        strokeOpacity="0.8"
        strokeWidth="1.5"
      />
      <circle cx={cx} cy={cy} r={inner} fill="rgba(0,0,0,0.3)" stroke={stroke} strokeOpacity="0.6" />
    </g>
  );
}
