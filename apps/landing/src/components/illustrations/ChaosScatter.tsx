type Props = { className?: string };

/**
 * BEFORE state: scattered branded doc tiles with tangled dashed connectors,
 * faint question-mark glyphs in the background suggesting confusion. Each
 * doc tile shows a small source logo chip + title + a few content lines.
 */
export function ChaosScatter({ className }: Props) {
  const docs: Array<{
    x: number;
    y: number;
    source: SourceKey;
    title: string;
  }> = [
    { x: 38, y: 32, source: 'notion', title: 'System Overview' },
    { x: 244, y: 22, source: 'confluence', title: 'Architecture' },
    { x: 408, y: 42, source: 'github', title: 'README.md' },
    { x: 30, y: 162, source: 'github', title: 'ADR-042' },
    { x: 246, y: 178, source: 'gdoc', title: 'Onboarding' },
    { x: 408, y: 162, source: 'wiki', title: 'Internal Wiki' },
  ];

  // Faint background question-mark / x glyphs
  const glyphs: Array<{ x: number; y: number; type: 'q' | 'x'; o: number }> = [
    { x: 18, y: 14, type: 'q', o: 0.22 },
    { x: 196, y: 130, type: 'q', o: 0.18 },
    { x: 470, y: 22, type: 'q', o: 0.16 },
    { x: 96, y: 132, type: 'x', o: 0.2 },
    { x: 358, y: 140, type: 'x', o: 0.22 },
    { x: 196, y: 4, type: 'x', o: 0.14 },
    { x: 470, y: 140, type: 'x', o: 0.18 },
    { x: 18, y: 268, type: 'q', o: 0.14 },
  ];

  return (
    <svg
      viewBox="0 0 500 300"
      role="img"
      aria-label="Scattered docs from Notion, Confluence, GitHub, Google Docs and wikis with tangled dashed connections"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <defs>
        <linearGradient id="cs-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D1117" />
          <stop offset="100%" stopColor="#020915" />
        </linearGradient>
        <linearGradient id="cs-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2230" />
          <stop offset="100%" stopColor="#10151E" />
        </linearGradient>
        <linearGradient id="cs-corner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#243042" />
          <stop offset="100%" stopColor="#161C26" />
        </linearGradient>
        <filter id="cs-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
          <feOffset dx="0" dy="2" result="off" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.5" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* dark backdrop */}
      <rect x="0" y="0" width="500" height="300" fill="url(#cs-bg)" rx="12" />

      {/* faint glyphs (question marks, x's) */}
      <g
        fontSize="14"
        fontWeight="600"
        fill="#8B949E"
        fontFamily="system-ui, sans-serif"
      >
        {glyphs.map((g, i) => (
          <text
            key={i}
            x={g.x}
            y={g.y + 12}
            opacity={g.o}
            textAnchor="middle"
          >
            {g.type === 'q' ? '?' : '×'}
          </text>
        ))}
      </g>

      {/* tangled broken connectors */}
      <g
        stroke="#3A4658"
        strokeOpacity="0.7"
        strokeWidth="1.2"
        strokeDasharray="3 4"
        strokeLinecap="round"
        fill="none"
      >
        <path d="M120,80 C200,140 200,30 270,70" />
        <path d="M310,70 C360,120 400,40 440,90" />
        <path d="M80,210 C160,160 220,260 300,210" />
        <path d="M120,80 C150,180 220,210 160,200" />
        <path d="M440,90 C460,160 400,260 360,210" />
        <path d="M270,70 C260,180 200,220 160,200" />
        <path d="M80,100 C150,180 320,200 440,120" />
      </g>

      {/* small intersection × markers */}
      <g stroke="#3A4658" strokeWidth="1.1" strokeLinecap="round" opacity="0.6">
        {[
          [206, 102],
          [296, 92],
          [194, 198],
          [364, 184],
          [156, 170],
        ].map(([cx, cy], i) => (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            <line x1="-3" y1="-3" x2="3" y2="3" />
            <line x1="-3" y1="3" x2="3" y2="-3" />
          </g>
        ))}
      </g>

      {/* doc tiles */}
      {docs.map((d, i) => (
        <DocTile key={i} {...d} />
      ))}
    </svg>
  );
}

type SourceKey = 'notion' | 'confluence' | 'github' | 'gdoc' | 'wiki' | 'slack';

function DocTile({
  x,
  y,
  source,
  title,
}: {
  x: number;
  y: number;
  source: SourceKey;
  title: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`} filter="url(#cs-shadow)">
      {/* card */}
      <rect
        width="92"
        height="110"
        rx="8"
        fill="url(#cs-card)"
        stroke="#30394A"
        strokeWidth="1"
      />
      {/* folded corner */}
      <path
        d="M70,0 L92,22 L70,22 Z"
        fill="url(#cs-corner)"
        stroke="#30394A"
        strokeWidth="0.8"
      />
      {/* source chip */}
      <g transform="translate(10 10)">
        <SourceChip source={source} />
      </g>
      {/* title */}
      <text
        x="10"
        y="56"
        fontSize="9"
        fontWeight="600"
        fill="#C9D1D9"
        fontFamily="system-ui, sans-serif"
      >
        {title}
      </text>
      {/* content lines */}
      <g>
        <rect x="10" y="68" width="48" height="3" rx="1.5" fill="#268CF5" opacity="0.5" />
        <rect x="10" y="76" width="68" height="3" rx="1.5" fill="#30394A" />
        <rect x="10" y="84" width="56" height="3" rx="1.5" fill="#30394A" />
        <rect x="10" y="92" width="62" height="3" rx="1.5" fill="#30394A" />
      </g>
    </g>
  );
}

function SourceChip({ source }: { source: SourceKey }) {
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
        width="18"
        height="18"
        rx="4"
        fill={m.bg}
        stroke="#30394A"
        strokeWidth="0.6"
      />
      <text
        x="9"
        y="13"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill={m.fg}
        fontFamily="system-ui, sans-serif"
      >
        {m.label}
      </text>
    </g>
  );
}
