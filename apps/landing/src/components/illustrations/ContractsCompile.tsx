type Props = { className?: string };

/**
 * Step 1 sub-card: Verified Knowledge Base → Compile → four typed contract
 * cards (Data, State, Policy, API). Each contract card shows a small icon
 * and a few lines of structured syntax.
 */
export function ContractsCompile({ className }: Props) {
  const contracts: Array<{
    title: string;
    kind: ContractKind;
    lines: Array<{ k: string; v: string }>;
  }> = [
    {
      title: 'Data Contract',
      kind: 'data',
      lines: [
        { k: 'user_id', v: 'string' },
        { k: 'retry_limit', v: 'int' },
        { k: 'timeout_sec', v: 'int' },
      ],
    },
    {
      title: 'State Machine',
      kind: 'state',
      lines: [
        { k: 'pending', v: '→ running' },
        { k: 'running', v: '→ succeeded' },
        { k: 'running', v: '→ failed' },
      ],
    },
    {
      title: 'Policy Contract',
      kind: 'policy',
      lines: [
        { k: 'retention.days', v: '= 90' },
        { k: 'timeout_sec', v: '≤ 30' },
        { k: 'audit', v: 'required' },
      ],
    },
    {
      title: 'API Contract',
      kind: 'api',
      lines: [
        { k: 'POST', v: '/orders' },
        { k: '200', v: 'Order' },
        { k: '400', v: 'Error' },
      ],
    },
  ];

  return (
    <svg
      viewBox="0 0 760 320"
      role="img"
      aria-label="Verified knowledge base compiles into four typed contracts: data, state, policy, and API"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <defs>
        <linearGradient id="cc-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D1117" />
          <stop offset="100%" stopColor="#020915" />
        </linearGradient>
        <linearGradient id="cc-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2230" />
          <stop offset="100%" stopColor="#10151E" />
        </linearGradient>
        <linearGradient id="cc-doc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1E2A3F" />
          <stop offset="100%" stopColor="#0F1726" />
        </linearGradient>
        <linearGradient id="cc-corner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2A3A55" />
          <stop offset="100%" stopColor="#162133" />
        </linearGradient>
        <radialGradient id="cc-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cc-accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0.95" />
        </linearGradient>
        <filter id="cc-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.5" />
          <feOffset dx="0" dy="2" result="off" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.5" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker
          id="cc-arrow"
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

      <rect x="0" y="0" width="760" height="320" fill="url(#cc-bg)" rx="14" />

      {/* KB halo */}
      <circle cx="120" cy="160" r="100" fill="url(#cc-glow)" />

      {/* === Verified KB doc === */}
      <g transform="translate(60 76)" filter="url(#cc-shadow)">
        <rect width="120" height="172" rx="10" fill="url(#cc-doc)" stroke="#268CF5" strokeOpacity="0.75" strokeWidth="1.4" />
        <path d="M88,0 L120,32 L88,32 Z" fill="url(#cc-corner)" stroke="#268CF5" strokeOpacity="0.55" strokeWidth="0.8" />
        <g>
          <rect x="14" y="48" width="68" height="3.5" rx="1.5" fill="#268CF5" opacity="0.65" />
          <rect x="14" y="58" width="90" height="3" rx="1.5" fill="#30394A" />
          <rect x="14" y="66" width="70" height="3" rx="1.5" fill="#30394A" />
          <rect x="14" y="74" width="84" height="3" rx="1.5" fill="#30394A" />
          <rect x="14" y="82" width="76" height="3" rx="1.5" fill="#30394A" />
          <rect x="14" y="90" width="92" height="3" rx="1.5" fill="#30394A" />
          <rect x="14" y="98" width="68" height="3" rx="1.5" fill="#30394A" />
        </g>
        <g transform="translate(78 134)">
          <circle cx="14" cy="14" r="14.5" fill="#0D1117" />
          <circle cx="14" cy="14" r="13" fill="#268CF5" />
          <path d="M8,14.2 L12.5,18.6 L20,11" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
      <text x="120" y="270" textAnchor="middle" fontSize="11" fontWeight="700" fill="#C9D1D9" letterSpacing="0.4">
        Verified Knowledge Base
      </text>
      <text x="120" y="284" textAnchor="middle" fontSize="8.5" fill="#8B949E">
        Single source of truth
      </text>

      {/* arrow KB -> compile */}
      <line x1="190" y1="160" x2="270" y2="160" stroke="url(#cc-accent)" strokeWidth="2" markerEnd="url(#cc-arrow)" />

      {/* === Compile badge === */}
      <g transform="translate(296 120)" filter="url(#cc-shadow)">
        <circle cx="40" cy="40" r="46" fill="url(#cc-glow)" />
        <circle cx="40" cy="40" r="36" fill="url(#cc-panel)" stroke="#268CF5" strokeOpacity="0.8" strokeWidth="1.4" />
        <Gear cx={40} cy={40} r={22} accent />
      </g>
      <text x="336" y="240" textAnchor="middle" fontSize="11" fontWeight="700" fill="#C9D1D9" letterSpacing="0.4">
        Compile
      </text>
      <text x="336" y="254" textAnchor="middle" fontSize="8.5" fill="#8B949E">
        Deterministic transformation
      </text>

      {/* arrow compile -> contracts */}
      <line x1="386" y1="160" x2="446" y2="160" stroke="url(#cc-accent)" strokeWidth="2" markerEnd="url(#cc-arrow)" />

      {/* === Contracts column (2x2 grid) === */}
      <g>
        {contracts.map((c, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = 460 + col * 152;
          const y = 26 + row * 138;
          return <ContractCard key={i} x={x} y={y} {...c} />;
        })}
      </g>

      <text x="612" y="306" textAnchor="middle" fontSize="9" fontWeight="700" fill="#8B949E" letterSpacing="0.5">
        VERSIONED · VALIDATABLE · ENFORCEABLE
      </text>
    </svg>
  );
}

type ContractKind = 'data' | 'state' | 'policy' | 'api';

function ContractCard({
  x,
  y,
  title,
  kind,
  lines,
}: {
  x: number;
  y: number;
  title: string;
  kind: ContractKind;
  lines: Array<{ k: string; v: string }>;
}) {
  const iconColor = {
    data: '#268CF5',
    state: '#7C9CF5',
    policy: '#10B981',
    api: '#A371F7',
  }[kind];

  return (
    <g transform={`translate(${x} ${y})`} filter="url(#cc-shadow)">
      <rect width="144" height="124" rx="10" fill="url(#cc-panel)" stroke="#30394A" strokeWidth="1" />
      {/* header */}
      <g transform="translate(12 12)">
        <rect width="20" height="20" rx="4" fill={`${iconColor}33`} stroke={iconColor} strokeOpacity="0.7" strokeWidth="0.9" />
        <ContractIcon kind={kind} color={iconColor} />
      </g>
      <text x="40" y="26" fontSize="10.5" fontWeight="700" fill="#C9D1D9">
        {title}
      </text>
      {/* divider */}
      <line x1="12" y1="42" x2="132" y2="42" stroke="#30394A" strokeWidth="0.8" />
      {/* monospace lines */}
      <g fontFamily="ui-monospace, SFMono-Regular, monospace" fontSize="8.5">
        {lines.map((ln, i) => (
          <g key={i} transform={`translate(14 ${60 + i * 18})`}>
            <text fill="#C9D1D9">{ln.k}</text>
            <text x="74" fill={iconColor} fontWeight="600">{ln.v}</text>
          </g>
        ))}
      </g>
    </g>
  );
}

function ContractIcon({ kind, color }: { kind: ContractKind; color: string }) {
  switch (kind) {
    case 'data':
      return (
        <g fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round">
          <path d="M5,7 L9,7 L9,11 L5,11 Z" />
          <path d="M11,7 L15,7 L15,11 L11,11 Z" />
          <path d="M8,13 L12,13" />
        </g>
      );
    case 'state':
      return (
        <g fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round">
          <circle cx="6" cy="10" r="2.2" />
          <circle cx="14" cy="10" r="2.2" />
          <path d="M8.3,10 L11.7,10" />
        </g>
      );
    case 'policy':
      return (
        <g fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10,4 L15,7 L15,12 C15,14.5 12.5,15.5 10,16 C7.5,15.5 5,14.5 5,12 L5,7 Z" />
          <path d="M7.5,10 L9,11.5 L12.5,8" />
        </g>
      );
    case 'api':
      return (
        <g fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round">
          <text x="3" y="14" fontSize="9" fontWeight="700" fill={color} stroke="none" fontFamily="ui-monospace, monospace">
            {'{ }'}
          </text>
        </g>
      );
  }
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
  const fill = accent ? 'rgba(38,140,245,0.32)' : 'rgba(139,148,158,0.14)';
  return (
    <g>
      <polygon
        points={points.join(' ')}
        fill={fill}
        stroke={stroke}
        strokeOpacity="0.95"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx={cx} cy={cy} r={inner} fill="#0D1117" stroke={stroke} strokeOpacity="0.8" strokeWidth="0.9" />
      <circle cx={cx} cy={cy} r={inner * 0.42} fill={accent ? '#268CF5' : '#3A4658'} />
    </g>
  );
}
