type Props = { className?: string };

/**
 * AFTER state: branded documentation sources flow into a Verified Knowledge
 * Base (glowing doc with check badge), into the TrueCourse Engine
 * (gears + circuitry detail), and out to AI Agents + Engineers. A code
 * panel below feeds into the engine too.
 */
export function VerifiedFlow({ className }: Props) {
  const sources: Array<{ label: string; source: SourceKey }> = [
    { label: 'Notion', source: 'notion' },
    { label: 'Confluence', source: 'confluence' },
    { label: 'GitHub', source: 'github' },
    { label: 'ADR-042', source: 'github' },
    { label: 'Slack', source: 'slack' },
    { label: 'Google Doc', source: 'gdoc' },
  ];

  return (
    <svg
      viewBox="0 0 560 340"
      role="img"
      aria-label="Verified knowledge base feeding the TrueCourse engine, with outputs to AI agents and engineers"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <defs>
        <linearGradient id="vf-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D1117" />
          <stop offset="100%" stopColor="#020915" />
        </linearGradient>
        <linearGradient id="vf-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2230" />
          <stop offset="100%" stopColor="#10151E" />
        </linearGradient>
        <linearGradient id="vf-doc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1E2A3F" />
          <stop offset="100%" stopColor="#0F1726" />
        </linearGradient>
        <linearGradient id="vf-corner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2A3A55" />
          <stop offset="100%" stopColor="#162133" />
        </linearGradient>
        <radialGradient id="vf-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#268CF5" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="vf-engine-glow" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="vf-arrow-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0.95" />
        </linearGradient>
        <filter id="vf-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
          <feOffset dx="0" dy="2" result="off" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.45" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker
          id="vf-arrow"
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
      <rect x="0" y="0" width="560" height="340" fill="url(#vf-bg)" rx="12" />

      {/* central halo behind engine */}
      <ellipse cx="370" cy="170" rx="140" ry="110" fill="url(#vf-engine-glow)" />

      {/* Left source rail label */}
      <text
        x="14"
        y="20"
        fontSize="8"
        fontWeight="700"
        fill="#8B949E"
        letterSpacing="1.2"
      >
        DOCUMENTATION SOURCES
      </text>

      {/* Source list */}
      <g>
        {sources.map((s, i) => (
          <g key={s.label} transform={`translate(12 ${30 + i * 42})`}>
            <rect
              width="108"
              height="34"
              rx="6"
              fill="url(#vf-panel)"
              stroke="#30394A"
              strokeWidth="0.8"
              filter="url(#vf-shadow)"
            />
            <g transform="translate(8 8)">
              <SourceChip source={s.source} size={18} />
            </g>
            <text
              x="34"
              y="22"
              fontSize="10"
              fontWeight="600"
              fill="#C9D1D9"
            >
              {s.label}
            </text>
          </g>
        ))}
      </g>

      {/* curved connectors source -> KB */}
      <g fill="none" stroke="url(#vf-arrow-stroke)" strokeWidth="1.4">
        {sources.map((_, i) => {
          const y1 = 47 + i * 42;
          const y2 = 170;
          return (
            <path
              key={i}
              d={`M122,${y1} C160,${y1} 160,${y2} 196,${y2}`}
              opacity="0.7"
            />
          );
        })}
      </g>

      {/* KB halo */}
      <circle cx="234" cy="170" r="70" fill="url(#vf-glow)" />

      {/* Verified Knowledge Base — glowing doc with check */}
      <g transform="translate(196 116)" filter="url(#vf-shadow)">
        <rect
          width="76"
          height="108"
          rx="8"
          fill="url(#vf-doc)"
          stroke="#268CF5"
          strokeOpacity="0.7"
          strokeWidth="1.2"
        />
        <path
          d="M54,0 L76,22 L54,22 Z"
          fill="url(#vf-corner)"
          stroke="#268CF5"
          strokeOpacity="0.6"
          strokeWidth="0.8"
        />
        {/* content lines */}
        <g>
          <rect x="10" y="36" width="44" height="3.5" rx="1.5" fill="#268CF5" opacity="0.7" />
          <rect x="10" y="46" width="56" height="3" rx="1.5" fill="#30394A" />
          <rect x="10" y="54" width="40" height="3" rx="1.5" fill="#30394A" />
          <rect x="10" y="62" width="50" height="3" rx="1.5" fill="#30394A" />
          <rect x="10" y="70" width="44" height="3" rx="1.5" fill="#30394A" />
          <rect x="10" y="78" width="54" height="3" rx="1.5" fill="#30394A" />
        </g>
        {/* check badge */}
        <g transform="translate(46 84)">
          <circle cx="10" cy="10" r="11" fill="#0D1117" />
          <circle cx="10" cy="10" r="10" fill="#268CF5" />
          <path
            d="M5.5,10.2 L8.5,13.2 L14.5,7.2"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
      <text
        x="234"
        y="244"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill="#C9D1D9"
        letterSpacing="0.4"
      >
        VERIFIED KB
      </text>

      {/* arrow KB -> Engine */}
      <line
        x1="276"
        y1="170"
        x2="312"
        y2="170"
        stroke="url(#vf-arrow-stroke)"
        strokeWidth="2"
        markerEnd="url(#vf-arrow)"
      />

      {/* Engine */}
      <g transform="translate(318 102)" filter="url(#vf-shadow)">
        <rect
          width="140"
          height="138"
          rx="12"
          fill="url(#vf-panel)"
          stroke="#268CF5"
          strokeOpacity="0.7"
          strokeWidth="1.2"
        />
        {/* inner circuitry lines */}
        <g stroke="#268CF5" strokeOpacity="0.25" strokeWidth="0.8" fill="none">
          <path d="M10,30 L36,30 L36,46" />
          <path d="M130,30 L104,30 L104,46" />
          <path d="M10,108 L36,108 L36,92" />
          <path d="M130,108 L104,108 L104,92" />
        </g>
        <g fill="#268CF5" opacity="0.5">
          <circle cx="10" cy="30" r="1.2" />
          <circle cx="130" cy="30" r="1.2" />
          <circle cx="10" cy="108" r="1.2" />
          <circle cx="130" cy="108" r="1.2" />
        </g>

        <text
          x="70"
          y="22"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="#C9D1D9"
          letterSpacing="0.5"
        >
          TrueCourse Engine
        </text>

        {/* gears */}
        <Gear cx={42} cy={74} r={20} accent />
        <Gear cx={84} cy={86} r={14} />
        <Gear cx={108} cy={66} r={11} accent />

        <text
          x="70"
          y="124"
          textAnchor="middle"
          fontSize="8"
          fill="#8B949E"
          letterSpacing="0.4"
        >
          Deterministic · No LLM in loop
        </text>
      </g>

      {/* arrow engine -> AI Agents */}
      <path
        d="M460,134 C480,134 490,98 500,80"
        fill="none"
        stroke="url(#vf-arrow-stroke)"
        strokeWidth="1.8"
        markerEnd="url(#vf-arrow)"
      />
      {/* arrow engine -> Engineers */}
      <path
        d="M460,208 C480,208 490,244 500,262"
        fill="none"
        stroke="url(#vf-arrow-stroke)"
        strokeWidth="1.8"
        markerEnd="url(#vf-arrow)"
      />

      {/* AI Agents output */}
      <g transform="translate(490 36)" filter="url(#vf-shadow)">
        <rect
          width="64"
          height="62"
          rx="8"
          fill="url(#vf-panel)"
          stroke="#268CF5"
          strokeOpacity="0.55"
          strokeWidth="1"
        />
        <g transform="translate(20 8)">
          <BotAvatar />
        </g>
        <text
          x="32"
          y="50"
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          fill="#C9D1D9"
        >
          AI AGENTS
        </text>
        <text
          x="32"
          y="59"
          textAnchor="middle"
          fontSize="6.5"
          fill="#8B949E"
        >
          Grounded
        </text>
      </g>

      {/* Engineers output */}
      <g transform="translate(490 240)" filter="url(#vf-shadow)">
        <rect
          width="64"
          height="62"
          rx="8"
          fill="url(#vf-panel)"
          stroke="#268CF5"
          strokeOpacity="0.55"
          strokeWidth="1"
        />
        <g transform="translate(20 8)">
          <EngineerAvatar />
        </g>
        <text
          x="32"
          y="50"
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          fill="#C9D1D9"
        >
          ENGINEERS
        </text>
        <text
          x="32"
          y="59"
          textAnchor="middle"
          fontSize="6.5"
          fill="#8B949E"
        >
          Aligned
        </text>
      </g>

      {/* Code panel below engine */}
      <g transform="translate(318 256)" filter="url(#vf-shadow)">
        <rect
          width="140"
          height="68"
          rx="8"
          fill="url(#vf-panel)"
          stroke="#30394A"
          strokeWidth="0.8"
        />
        <text
          x="70"
          y="14"
          textAnchor="middle"
          fontSize="7"
          fontWeight="700"
          fill="#8B949E"
          letterSpacing="0.8"
        >
          CODE
        </text>
        <g fontFamily="ui-monospace, SFMono-Regular, monospace" fontSize="7">
          <text x="10" y="28" fill="#268CF5">fn</text>
          <text x="22" y="28" fill="#C9D1D9">charge() {'{'}</text>
          <text x="16" y="40" fill="#8B949E">retry(3)</text>
          <text x="16" y="52" fill="#8B949E">timeout(30s)</text>
          <text x="10" y="62" fill="#C9D1D9">{'}'}</text>
        </g>
      </g>
      {/* arrow code -> engine */}
      <line
        x1="388"
        y1="252"
        x2="388"
        y2="244"
        stroke="url(#vf-arrow-stroke)"
        strokeWidth="2"
        markerEnd="url(#vf-arrow)"
      />
    </svg>
  );
}

type SourceKey = 'notion' | 'confluence' | 'github' | 'gdoc' | 'wiki' | 'slack';

function SourceChip({ source, size = 18 }: { source: SourceKey; size?: number }) {
  const meta: Record<SourceKey, { label: string; bg: string; fg: string }> = {
    notion: { label: 'N', bg: '#1F1F1F', fg: '#FFFFFF' },
    confluence: { label: 'C', bg: '#0052CC', fg: '#FFFFFF' },
    github: { label: 'GH', bg: '#161B22', fg: '#C9D1D9' },
    gdoc: { label: 'D', bg: '#1A73E8', fg: '#FFFFFF' },
    wiki: { label: 'W', bg: '#2D3748', fg: '#C9D1D9' },
    slack: { label: 'S', bg: '#4A154B', fg: '#FFFFFF' },
  };
  const m = meta[source];
  return (
    <g>
      <rect
        width={size}
        height={size}
        rx="4"
        fill={m.bg}
        stroke="#30394A"
        strokeWidth="0.6"
      />
      <text
        x={size / 2}
        y={size / 2 + 3}
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill={m.fg}
      >
        {m.label}
      </text>
    </g>
  );
}

function BotAvatar() {
  return (
    <g>
      {/* antenna */}
      <line x1="12" y1="0" x2="12" y2="4" stroke="#268CF5" strokeWidth="1.2" />
      <circle cx="12" cy="0.5" r="1.2" fill="#268CF5" />
      {/* head */}
      <rect
        x="2"
        y="4"
        width="20"
        height="18"
        rx="4"
        fill="#1E2A3F"
        stroke="#268CF5"
        strokeOpacity="0.8"
        strokeWidth="1"
      />
      <circle cx="8" cy="12" r="1.6" fill="#268CF5" />
      <circle cx="16" cy="12" r="1.6" fill="#268CF5" />
      <path d="M8,17 L16,17" stroke="#268CF5" strokeOpacity="0.6" strokeWidth="1" strokeLinecap="round" />
      {/* check */}
      <circle cx="22" cy="6" r="3.4" fill="#268CF5" />
      <path
        d="M20.4,6.2 L21.8,7.6 L23.6,5.2"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

function EngineerAvatar() {
  return (
    <g>
      {/* head */}
      <circle cx="12" cy="7" r="5" fill="#1E2A3F" stroke="#C9D1D9" strokeOpacity="0.7" strokeWidth="0.9" />
      {/* shoulders */}
      <path
        d="M2,22 C2,15 22,15 22,22 L22,24 L2,24 Z"
        fill="#1E2A3F"
        stroke="#C9D1D9"
        strokeOpacity="0.7"
        strokeWidth="0.9"
      />
    </g>
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
  const fill = accent ? 'rgba(38,140,245,0.28)' : 'rgba(139,148,158,0.12)';
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
      <circle cx={cx} cy={cy} r={inner * 0.4} fill={accent ? '#268CF5' : '#3A4658'} opacity={accent ? 0.8 : 1} />
    </g>
  );
}
