type Props = { className?: string };

/**
 * Combined "What TrueCourse does" diagram: Verified Knowledge Base + Codebase
 * feed into the TrueCourse Verification Engine, producing Drift Report,
 * AI Guardrails, and Audit Log on the right.
 */
export function EngineDiagram({ className }: Props) {
  return (
    <svg
      viewBox="0 0 960 360"
      role="img"
      aria-label="Verified knowledge base and codebase feeding the TrueCourse verification engine, producing drift report, AI guardrails, and audit log"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <defs>
        <linearGradient id="ed-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D1117" />
          <stop offset="100%" stopColor="#020915" />
        </linearGradient>
        <linearGradient id="ed-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2230" />
          <stop offset="100%" stopColor="#10151E" />
        </linearGradient>
        <linearGradient id="ed-doc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1E2A3F" />
          <stop offset="100%" stopColor="#0F1726" />
        </linearGradient>
        <linearGradient id="ed-corner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2A3A55" />
          <stop offset="100%" stopColor="#162133" />
        </linearGradient>
        <linearGradient id="ed-amber-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2A2218" />
          <stop offset="100%" stopColor="#15110A" />
        </linearGradient>
        <radialGradient id="ed-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ed-accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0.95" />
        </linearGradient>
        <filter id="ed-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
          <feOffset dx="0" dy="3" result="off" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.45" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker
          id="ed-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#268CF5" />
        </marker>
      </defs>

      {/* backdrop */}
      <rect x="0" y="0" width="960" height="360" fill="url(#ed-bg)" rx="14" />

      {/* central halo */}
      <ellipse cx="480" cy="180" rx="180" ry="140" fill="url(#ed-glow)" />

      {/* === Verified Knowledge Base === */}
      <g transform="translate(40 50)" filter="url(#ed-shadow)">
        <rect
          width="240"
          height="120"
          rx="12"
          fill="url(#ed-panel)"
          stroke="#268CF5"
          strokeOpacity="0.55"
          strokeWidth="1.2"
        />
        {/* doc icon */}
        <g transform="translate(18 18)">
          <rect width="42" height="58" rx="5" fill="url(#ed-doc)" stroke="#268CF5" strokeOpacity="0.6" strokeWidth="0.9" />
          <path d="M30,0 L42,12 L30,12 Z" fill="url(#ed-corner)" stroke="#268CF5" strokeOpacity="0.5" strokeWidth="0.6" />
          <rect x="6" y="20" width="22" height="2.4" rx="1.2" fill="#268CF5" opacity="0.6" />
          <rect x="6" y="26" width="28" height="2" rx="1" fill="#30394A" />
          <rect x="6" y="32" width="18" height="2" rx="1" fill="#30394A" />
          <rect x="6" y="38" width="26" height="2" rx="1" fill="#30394A" />
          {/* check */}
          <g transform="translate(26 44)">
            <circle cx="6" cy="6" r="6.2" fill="#0D1117" />
            <circle cx="6" cy="6" r="5.4" fill="#268CF5" />
            <path d="M3.2,6.1 L5.2,8.1 L8.8,4.5" fill="none" stroke="#FFFFFF" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
        <text x="78" y="36" fontSize="13" fontWeight="700" fill="#C9D1D9">Verified Knowledge Base</text>
        <text x="78" y="54" fontSize="9.5" fill="#8B949E">Single source of truth for</text>
        <text x="78" y="68" fontSize="9.5" fill="#8B949E">decisions, design, and standards.</text>
        <g fontSize="9" fill="#C9D1D9" fontWeight="500">
          <g transform="translate(78 84)">
            <circle cx="3" cy="-2" r="1.6" fill="#268CF5" />
            <text x="10" y="0">Architecture Decisions</text>
          </g>
          <g transform="translate(78 96)">
            <circle cx="3" cy="-2" r="1.6" fill="#268CF5" />
            <text x="10" y="0">Code &amp; Standards</text>
          </g>
        </g>
      </g>

      {/* === Codebase === */}
      <g transform="translate(40 190)" filter="url(#ed-shadow)">
        <rect
          width="240"
          height="120"
          rx="12"
          fill="url(#ed-panel)"
          stroke="#30394A"
          strokeWidth="1"
        />
        {/* file tree icon */}
        <g transform="translate(18 18)">
          <rect width="58" height="74" rx="5" fill="#0D1117" stroke="#30394A" strokeWidth="0.8" />
          <g fontFamily="ui-monospace, SFMono-Regular, monospace" fontSize="6.5" fill="#8B949E">
            <text x="6" y="14">src/</text>
            <text x="12" y="24" fill="#C9D1D9">main.ts</text>
            <text x="12" y="34" fill="#C9D1D9">api.ts</text>
            <text x="12" y="44">config.ts</text>
            <text x="6" y="56">README</text>
            <text x="6" y="66">package.json</text>
          </g>
          {/* highlighted line */}
          <rect x="4" y="18" width="50" height="8" rx="1.5" fill="#268CF5" opacity="0.12" />
        </g>
        <text x="92" y="36" fontSize="13" fontWeight="700" fill="#C9D1D9">Codebase</text>
        <text x="92" y="54" fontSize="9.5" fill="#8B949E">Source of implicit decisions</text>
        <text x="92" y="68" fontSize="9.5" fill="#8B949E">and real-world implementation.</text>
        <g fontSize="9" fill="#C9D1D9" fontWeight="500">
          <g transform="translate(92 84)">
            <circle cx="3" cy="-2" r="1.6" fill="#8B949E" />
            <text x="10" y="0">Inferred config &amp; limits</text>
          </g>
          <g transform="translate(92 96)">
            <circle cx="3" cy="-2" r="1.6" fill="#8B949E" />
            <text x="10" y="0">Runtime behavior</text>
          </g>
        </g>
      </g>

      {/* arrows into engine */}
      <path d="M286,110 C340,110 340,180 396,180" fill="none" stroke="url(#ed-accent)" strokeWidth="2" markerEnd="url(#ed-arrow)" />
      <path d="M286,250 C340,250 340,180 396,180" fill="none" stroke="url(#ed-accent)" strokeWidth="2" markerEnd="url(#ed-arrow)" />

      {/* === Engine === */}
      <g transform="translate(400 76)" filter="url(#ed-shadow)">
        <rect
          width="200"
          height="208"
          rx="14"
          fill="url(#ed-panel)"
          stroke="#268CF5"
          strokeOpacity="0.8"
          strokeWidth="1.4"
        />
        {/* inner circuit accents */}
        <g stroke="#268CF5" strokeOpacity="0.22" strokeWidth="0.8" fill="none">
          <path d="M10,36 L36,36 L36,52" />
          <path d="M190,36 L164,36 L164,52" />
          <path d="M10,172 L36,172 L36,156" />
          <path d="M190,172 L164,172 L164,156" />
        </g>
        <g fill="#268CF5" opacity="0.55">
          <circle cx="10" cy="36" r="1.4" />
          <circle cx="190" cy="36" r="1.4" />
          <circle cx="10" cy="172" r="1.4" />
          <circle cx="190" cy="172" r="1.4" />
        </g>

        {/* gears + circular arrows */}
        <g transform="translate(100 104)">
          <circle r="56" fill="none" stroke="#268CF5" strokeOpacity="0.18" strokeWidth="1.2" strokeDasharray="3 4" />
          <Gear cx={-22} cy={-6} r={22} accent />
          <Gear cx={18} cy={12} r={16} />
          <Gear cx={30} cy={-18} r={11} accent />
        </g>

        <text x="100" y="24" textAnchor="middle" fontSize="13" fontWeight="700" fill="#C9D1D9" letterSpacing="0.6">
          TrueCourse Engine
        </text>
        <text x="100" y="184" textAnchor="middle" fontSize="9" fontWeight="700" fill="#268CF5" letterSpacing="0.4">
          ALWAYS RUNNING
        </text>
        <text x="100" y="198" textAnchor="middle" fontSize="8.5" fill="#8B949E">
          Continuously verifying everything
        </text>
      </g>

      {/* arrows engine -> outputs */}
      <path d="M606,120 C660,120 660,80 712,80" fill="none" stroke="url(#ed-accent)" strokeWidth="2" markerEnd="url(#ed-arrow)" />
      <path d="M606,180 L712,180" stroke="url(#ed-accent)" strokeWidth="2" fill="none" markerEnd="url(#ed-arrow)" />
      <path d="M606,240 C660,240 660,280 712,280" fill="none" stroke="url(#ed-accent)" strokeWidth="2" markerEnd="url(#ed-arrow)" />

      {/* === Drift Report === */}
      <g transform="translate(720 46)" filter="url(#ed-shadow)">
        <rect width="200" height="74" rx="10" fill="url(#ed-amber-panel)" stroke="#F59E0B" strokeOpacity="0.55" strokeWidth="1" />
        <g transform="translate(14 14)">
          <path d="M14,0 L28,24 L0,24 Z" fill="rgba(245,158,11,0.25)" stroke="#F59E0B" strokeWidth="1.2" strokeLinejoin="round" />
          <text x="14" y="20" textAnchor="middle" fontSize="14" fontWeight="800" fill="#F59E0B">!</text>
        </g>
        <text x="50" y="26" fontSize="12" fontWeight="700" fill="#F59E0B">Drift Report</text>
        <text x="50" y="42" fontSize="9" fill="#C9D1D9">Detect what changed, where it drifted,</text>
        <text x="50" y="54" fontSize="9" fill="#C9D1D9">and why it matters.</text>
      </g>

      {/* === AI Guardrails === */}
      <g transform="translate(720 146)" filter="url(#ed-shadow)">
        <rect width="200" height="74" rx="10" fill="url(#ed-panel)" stroke="#268CF5" strokeOpacity="0.55" strokeWidth="1" />
        <g transform="translate(14 16)">
          <BotIcon />
        </g>
        <text x="50" y="26" fontSize="12" fontWeight="700" fill="#C9D1D9">AI Guardrails</text>
        <text x="50" y="42" fontSize="9" fill="#8B949E">Ground AI responses in verified truth</text>
        <text x="50" y="54" fontSize="9" fill="#8B949E">and prevent hallucinations.</text>
      </g>

      {/* === Audit Log === */}
      <g transform="translate(720 246)" filter="url(#ed-shadow)">
        <rect width="200" height="74" rx="10" fill="url(#ed-panel)" stroke="#10B981" strokeOpacity="0.55" strokeWidth="1" />
        <g transform="translate(14 16)">
          <AuditIcon />
        </g>
        <text x="50" y="26" fontSize="12" fontWeight="700" fill="#C9D1D9">Audit Log</text>
        <text x="50" y="42" fontSize="9" fill="#8B949E">Immutable record of verifications,</text>
        <text x="50" y="54" fontSize="9" fill="#8B949E">changes, and decisions.</text>
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
  const inner = r * 0.5;
  const points: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const angle = (i / (teeth * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r : r * 0.78;
    points.push(`${cx + Math.cos(angle) * rad},${cy + Math.sin(angle) * rad}`);
  }
  const stroke = accent ? '#268CF5' : '#8B949E';
  const fill = accent ? 'rgba(38,140,245,0.28)' : 'rgba(139,148,158,0.14)';
  return (
    <g>
      <polygon
        points={points.join(' ')}
        fill={fill}
        stroke={stroke}
        strokeOpacity="0.9"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx={cx} cy={cy} r={inner} fill="#0D1117" stroke={stroke} strokeOpacity="0.7" strokeWidth="0.9" />
      <circle cx={cx} cy={cy} r={inner * 0.42} fill={accent ? '#268CF5' : '#3A4658'} />
    </g>
  );
}

function BotIcon() {
  return (
    <g>
      <line x1="14" y1="0" x2="14" y2="4" stroke="#268CF5" strokeWidth="1.4" />
      <circle cx="14" cy="0.5" r="1.4" fill="#268CF5" />
      <rect x="2" y="4" width="24" height="20" rx="5" fill="#1E2A3F" stroke="#268CF5" strokeOpacity="0.8" strokeWidth="1" />
      <circle cx="10" cy="14" r="1.8" fill="#268CF5" />
      <circle cx="18" cy="14" r="1.8" fill="#268CF5" />
      <path d="M10,19 L18,19" stroke="#268CF5" strokeOpacity="0.6" strokeWidth="1" strokeLinecap="round" />
    </g>
  );
}

function AuditIcon() {
  return (
    <g>
      <rect x="2" y="2" width="24" height="24" rx="4" fill="#10B981" opacity="0.18" stroke="#10B981" strokeOpacity="0.7" strokeWidth="1" />
      <path d="M7,14 L12,19 L21,9" fill="none" stroke="#10B981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}
