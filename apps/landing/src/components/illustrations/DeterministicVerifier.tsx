type Props = { className?: string };

/**
 * Step 2 sub-card illustration: contracts + code → engine with gears → Drift
 * Report with amber warning. Three list items (one passing, two with amber).
 */
export function DeterministicVerifier({ className }: Props) {
  return (
    <svg
      viewBox="0 0 720 320"
      role="img"
      aria-label="Contracts and code feed into a deterministic verifier engine that produces a drift report"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id="dv-arrow"
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

      {/* Inputs: contracts + code */}
      <g>
        <rect
          x="20"
          y="44"
          width="148"
          height="86"
          rx="10"
          fill="rgba(148,163,184,0.08)"
          stroke="rgba(148,163,184,0.55)"
        />
        <text x="94" y="68" textAnchor="middle" fontSize="12" fill="#cbd5e1" fontWeight="600">
          contracts
        </text>
        <g opacity="0.7">
          <rect x="36" y="82" width="116" height="5" rx="2.5" fill="#94a3b8" />
          <rect x="36" y="94" width="92" height="5" rx="2.5" fill="#94a3b8" />
          <rect x="36" y="106" width="100" height="5" rx="2.5" fill="#94a3b8" />
        </g>
      </g>
      <g>
        <rect
          x="20"
          y="190"
          width="148"
          height="86"
          rx="10"
          fill="rgba(148,163,184,0.08)"
          stroke="rgba(148,163,184,0.55)"
        />
        <text x="94" y="214" textAnchor="middle" fontSize="12" fill="#cbd5e1" fontWeight="600">
          code
        </text>
        <g fontFamily="ui-monospace, monospace" fontSize="9" opacity="0.85">
          <text x="36" y="232" fill="#268CF5">
            fn
          </text>
          <text x="50" y="232" fill="#cbd5e1">
            charge() {'{'}
          </text>
          <text x="40" y="246" fill="#94a3b8">
            retry(3)
          </text>
          <text x="36" y="260" fill="#cbd5e1">
            {'}'}
          </text>
        </g>
      </g>

      {/* arrows into engine */}
      <line
        x1="172"
        y1="86"
        x2="244"
        y2="140"
        stroke="#268CF5"
        strokeOpacity="0.7"
        strokeWidth="2"
        markerEnd="url(#dv-arrow)"
      />
      <line
        x1="172"
        y1="234"
        x2="244"
        y2="180"
        stroke="#268CF5"
        strokeOpacity="0.7"
        strokeWidth="2"
        markerEnd="url(#dv-arrow)"
      />

      {/* Engine */}
      <g>
        <rect
          x="252"
          y="80"
          width="200"
          height="160"
          rx="14"
          fill="rgba(38,140,245,0.10)"
          stroke="#268CF5"
          strokeOpacity="0.6"
        />
        <text x="352" y="106" textAnchor="middle" fontSize="12" fill="#cbd5e1" fontWeight="600">
          Verifier engine
        </text>
        <Gear cx={314} cy={166} r={26} accent />
        <Gear cx={376} cy={184} r={20} />
        <Gear cx={416} cy={154} r={16} accent />
        <text x="352" y="226" textAnchor="middle" fontSize="10" fill="#94a3b8">
          deterministic
        </text>
      </g>

      {/* arrow to report */}
      <line
        x1="456"
        y1="160"
        x2="510"
        y2="160"
        stroke="#268CF5"
        strokeOpacity="0.85"
        strokeWidth="2"
        markerEnd="url(#dv-arrow)"
      />

      {/* Drift Report */}
      <g>
        <rect
          x="520"
          y="60"
          width="180"
          height="200"
          rx="12"
          fill="rgba(245,158,11,0.06)"
          stroke="rgba(245,158,11,0.55)"
        />
        <g transform="translate(536 80)">
          <path
            d="M12,0 L24,22 L0,22 Z"
            fill="rgba(245,158,11,0.25)"
            stroke="#fbbf24"
            strokeWidth="1.5"
          />
          <text x="12" y="18" textAnchor="middle" fontSize="14" fill="#fbbf24" fontWeight="700">
            !
          </text>
        </g>
        <text x="568" y="96" fontSize="12" fill="#fbbf24" fontWeight="600">
          Drift detected
        </text>

        {/* items */}
        <ReportRow y={120} status="ok" label="auth.bearer" />
        <ReportRow y={158} status="warn" label="ratelimit.max" />
        <ReportRow y={196} status="warn" label="retry.window" />
      </g>
    </svg>
  );
}

function ReportRow({
  y,
  status,
  label,
}: {
  y: number;
  status: 'ok' | 'warn';
  label: string;
}) {
  const fill = status === 'ok' ? '#22c55e' : '#fbbf24';
  return (
    <g transform={`translate(536 ${y})`}>
      <rect
        x="-2"
        y="-4"
        width="152"
        height="28"
        rx="6"
        fill={status === 'warn' ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.06)'}
      />
      <circle cx="8" cy="10" r="4.5" fill={fill} />
      <text
        x="22"
        y="14"
        fontSize="10"
        fill="#cbd5e1"
        fontFamily="ui-monospace, monospace"
      >
        {label}
      </text>
      <text
        x="148"
        y="14"
        textAnchor="end"
        fontSize="9"
        fill={fill}
        fontWeight="600"
      >
        {status === 'ok' ? 'PASS' : 'DRIFT'}
      </text>
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
        fill={accent ? 'rgba(38,140,245,0.20)' : 'rgba(148,163,184,0.12)'}
        stroke={stroke}
        strokeOpacity="0.85"
        strokeWidth="1.5"
      />
      <circle
        cx={cx}
        cy={cy}
        r={inner}
        fill="rgba(0,0,0,0.3)"
        stroke={stroke}
        strokeOpacity="0.6"
      />
    </g>
  );
}
