type Props = { className?: string };

/**
 * Step 1 sub-card illustration: KB → arrow → 3 contract files showing
 * structured syntax. Flat, two-tone.
 */
export function ContractsCompile({ className }: Props) {
  return (
    <svg
      viewBox="0 0 720 280"
      role="img"
      aria-label="Knowledge base compiles into three structured contract files"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id="cc-arrow"
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

      {/* KB block */}
      <g>
        <rect
          x="28"
          y="74"
          width="180"
          height="132"
          rx="14"
          fill="rgba(38,140,245,0.08)"
          stroke="#268CF5"
          strokeOpacity="0.55"
        />
        <text x="118" y="106" textAnchor="middle" fontSize="13" fill="#cbd5e1" fontWeight="600">
          Knowledge Base
        </text>
        <g opacity="0.7">
          <rect x="52" y="124" width="132" height="6" rx="3" fill="#94a3b8" />
          <rect x="52" y="140" width="104" height="6" rx="3" fill="#94a3b8" />
          <rect x="52" y="156" width="120" height="6" rx="3" fill="#94a3b8" />
          <rect x="52" y="172" width="88" height="6" rx="3" fill="#94a3b8" />
          <rect x="52" y="188" width="116" height="6" rx="3" fill="#94a3b8" />
        </g>
      </g>

      {/* arrow */}
      <line
        x1="212"
        y1="140"
        x2="282"
        y2="140"
        stroke="#268CF5"
        strokeOpacity="0.85"
        strokeWidth="2"
        markerEnd="url(#cc-arrow)"
      />
      <text x="247" y="125" textAnchor="middle" fontSize="10" fill="#94a3b8">
        compile
      </text>

      {/* Three contract files */}
      {[0, 1, 2].map((i) => (
        <ContractFile key={i} x={300 + i * 140} y={50 + i * 14} />
      ))}
    </svg>
  );
}

function ContractFile({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        width="124"
        height="180"
        rx="10"
        fill="rgba(148,163,184,0.08)"
        stroke="rgba(148,163,184,0.55)"
      />
      <rect x="0" y="0" width="124" height="22" rx="10" fill="rgba(38,140,245,0.18)" />
      <text x="12" y="15" fontSize="10" fill="#cbd5e1" fontFamily="ui-monospace, monospace">
        contract.tc
      </text>
      {/* code lines */}
      <g fontFamily="ui-monospace, monospace" fontSize="9">
        <text x="12" y="42" fill="#268CF5">
          spec
        </text>
        <text x="40" y="42" fill="#cbd5e1">
          Auth {'{'}
        </text>
        <text x="20" y="58" fill="#94a3b8">
          method:
        </text>
        <text x="56" y="58" fill="#cbd5e1">
          &quot;bearer&quot;
        </text>
        <text x="20" y="74" fill="#94a3b8">
          required:
        </text>
        <text x="64" y="74" fill="#cbd5e1">
          true
        </text>
        <text x="12" y="90" fill="#cbd5e1">
          {'}'}
        </text>
        <text x="12" y="112" fill="#268CF5">
          rule
        </text>
        <text x="40" y="112" fill="#cbd5e1">
          ratelimit
        </text>
        <text x="20" y="128" fill="#94a3b8">
          window:
        </text>
        <text x="60" y="128" fill="#cbd5e1">
          &quot;60s&quot;
        </text>
        <text x="20" y="144" fill="#94a3b8">
          max:
        </text>
        <text x="48" y="144" fill="#cbd5e1">
          100
        </text>
        <text x="12" y="166" fill="#94a3b8" opacity="0.5">
          ...
        </text>
      </g>
    </g>
  );
}
