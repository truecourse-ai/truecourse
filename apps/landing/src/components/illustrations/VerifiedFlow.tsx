type Props = { className?: string };

/**
 * AFTER column illustration: organized docs flow into a Verified Knowledge
 * Base, then into a TrueCourse Engine (with gears) at the center, code feeds
 * into the engine from below, AI Agents + Engineers consume on the right.
 */
export function VerifiedFlow({ className }: Props) {
  const docs = ['Notion', 'Confluence', 'README', 'ADR', 'Slack', 'Google Doc'];
  return (
    <svg
      viewBox="0 0 520 340"
      role="img"
      aria-label="Docs flow into a verified knowledge base feeding the TrueCourse engine, with outputs to AI agents and engineers"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id="vf-arrow"
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

      {/* Doc column */}
      <g>
        {docs.map((d, i) => (
          <g key={d} transform={`translate(8 ${18 + i * 42})`}>
            <rect
              width="92"
              height="34"
              rx="6"
              fill="rgba(38,140,245,0.08)"
              stroke="#268CF5"
              strokeOpacity="0.5"
            />
            <text x="46" y="21" textAnchor="middle" fontSize="10" fill="#cbd5e1">
              {d}
            </text>
          </g>
        ))}
      </g>

      {/* arrows docs -> KB */}
      <g
        stroke="#268CF5"
        strokeOpacity="0.6"
        strokeWidth="1.5"
        fill="none"
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line
            key={i}
            x1="102"
            y1={35 + i * 42}
            x2="156"
            y2="148"
            markerEnd="url(#vf-arrow)"
          />
        ))}
      </g>

      {/* Verified KB */}
      <g>
        <rect
          x="160"
          y="106"
          width="100"
          height="92"
          rx="10"
          fill="rgba(38,140,245,0.10)"
          stroke="#268CF5"
          strokeOpacity="0.65"
        />
        <text x="210" y="138" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontWeight="600">
          Verified
        </text>
        <text x="210" y="152" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontWeight="600">
          Knowledge
        </text>
        <text x="210" y="166" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontWeight="600">
          Base
        </text>
      </g>

      {/* arrow KB -> Engine */}
      <line
        x1="262"
        y1="152"
        x2="310"
        y2="152"
        stroke="#268CF5"
        strokeOpacity="0.85"
        strokeWidth="2"
        markerEnd="url(#vf-arrow)"
      />

      {/* Engine */}
      <g>
        <rect
          x="312"
          y="100"
          width="124"
          height="108"
          rx="12"
          fill="rgba(38,140,245,0.12)"
          stroke="#268CF5"
          strokeOpacity="0.7"
        />
        <text x="374" y="124" textAnchor="middle" fontSize="11" fill="#cbd5e1" fontWeight="600">
          TrueCourse
        </text>
        <text x="374" y="138" textAnchor="middle" fontSize="11" fill="#cbd5e1" fontWeight="600">
          Engine
        </text>
        <Gear cx={344} cy={172} r={16} accent />
        <Gear cx={384} cy={184} r={12} />
        <Gear cx={412} cy={168} r={11} accent />
      </g>

      {/* Code from below */}
      <g transform="translate(312 246)">
        <rect
          width="124"
          height="64"
          rx="8"
          fill="rgba(148,163,184,0.08)"
          stroke="rgba(148,163,184,0.55)"
        />
        <text x="62" y="20" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontWeight="600">
          code
        </text>
        <g fontFamily="ui-monospace, monospace" fontSize="8" opacity="0.85">
          <text x="14" y="36" fill="#268CF5">
            fn
          </text>
          <text x="26" y="36" fill="#cbd5e1">
            charge() {'{'}
          </text>
          <text x="20" y="48" fill="#94a3b8">
            ...
          </text>
          <text x="14" y="58" fill="#cbd5e1">
            {'}'}
          </text>
        </g>
      </g>
      <line
        x1="374"
        y1="246"
        x2="374"
        y2="212"
        stroke="#268CF5"
        strokeOpacity="0.7"
        strokeWidth="2"
        markerEnd="url(#vf-arrow)"
      />

      {/* arrows engine -> outputs */}
      <line
        x1="438"
        y1="130"
        x2="478"
        y2="84"
        stroke="#268CF5"
        strokeOpacity="0.7"
        strokeWidth="2"
        markerEnd="url(#vf-arrow)"
      />
      <line
        x1="438"
        y1="178"
        x2="478"
        y2="216"
        stroke="#268CF5"
        strokeOpacity="0.7"
        strokeWidth="2"
        markerEnd="url(#vf-arrow)"
      />

      {/* outputs */}
      <g transform="translate(452 50)">
        <rect
          width="60"
          height="40"
          rx="8"
          fill="rgba(38,140,245,0.10)"
          stroke="#268CF5"
          strokeOpacity="0.6"
        />
        <text x="30" y="18" textAnchor="middle" fontSize="9" fill="#cbd5e1">
          AI
        </text>
        <text x="30" y="30" textAnchor="middle" fontSize="9" fill="#cbd5e1">
          Agents
        </text>
      </g>
      <g transform="translate(452 220)">
        <rect
          width="60"
          height="40"
          rx="8"
          fill="rgba(38,140,245,0.10)"
          stroke="#268CF5"
          strokeOpacity="0.6"
        />
        <text x="30" y="18" textAnchor="middle" fontSize="9" fill="#cbd5e1">
          Engineers
        </text>
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
        fill={accent ? 'rgba(38,140,245,0.22)' : 'rgba(148,163,184,0.14)'}
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
