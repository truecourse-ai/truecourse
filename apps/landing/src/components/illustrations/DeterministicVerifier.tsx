type Props = { className?: string };

/**
 * Step 2 sub-card: a contract snippet + a code editor feed into the
 * Verifier engine, which produces a Drift Report with an amber warning
 * header and three rows (two drift, one passing).
 */
export function DeterministicVerifier({ className }: Props) {
  return (
    <svg
      viewBox="0 0 760 340"
      role="img"
      aria-label="Contract and code feed into the deterministic verifier engine, producing a drift report"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <defs>
        <linearGradient id="dv-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D1117" />
          <stop offset="100%" stopColor="#020915" />
        </linearGradient>
        <linearGradient id="dv-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2230" />
          <stop offset="100%" stopColor="#10151E" />
        </linearGradient>
        <linearGradient id="dv-amber-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2A2218" />
          <stop offset="100%" stopColor="#15110A" />
        </linearGradient>
        <linearGradient id="dv-amber-header" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.08" />
        </linearGradient>
        <radialGradient id="dv-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="dv-accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#268CF5" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#268CF5" stopOpacity="0.95" />
        </linearGradient>
        <filter id="dv-shadow" x="-30%" y="-30%" width="160%" height="160%">
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
          id="dv-arrow"
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

      <rect x="0" y="0" width="760" height="340" fill="url(#dv-bg)" rx="14" />

      {/* engine halo */}
      <ellipse cx="380" cy="170" rx="160" ry="130" fill="url(#dv-glow)" />

      {/* === Contract card === */}
      <g transform="translate(28 30)" filter="url(#dv-shadow)">
        <rect width="180" height="118" rx="10" fill="url(#dv-panel)" stroke="#268CF5" strokeOpacity="0.55" strokeWidth="1" />
        {/* header row */}
        <g transform="translate(12 12)">
          <rect width="20" height="20" rx="4" fill="rgba(38,140,245,0.2)" stroke="#268CF5" strokeOpacity="0.7" strokeWidth="0.9" />
          <text x="10" y="14.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#268CF5" fontFamily="ui-monospace, monospace">
            {'{ }'}
          </text>
        </g>
        <text x="40" y="26" fontSize="11" fontWeight="700" fill="#C9D1D9">Contract</text>
        <line x1="12" y1="40" x2="168" y2="40" stroke="#30394A" strokeWidth="0.8" />
        <g fontFamily="ui-monospace, SFMono-Regular, monospace" fontSize="9.5">
          <g transform="translate(14 58)">
            <text fill="#C9D1D9">retry_limit</text>
            <text x="96" fill="#268CF5" fontWeight="600">int</text>
          </g>
          <g transform="translate(14 76)">
            <text fill="#C9D1D9">timeout_sec</text>
            <text x="96" fill="#268CF5" fontWeight="600">int</text>
          </g>
          <g transform="translate(14 94)">
            <text fill="#C9D1D9">state</text>
            <text x="96" fill="#268CF5" fontWeight="600">enum</text>
          </g>
        </g>
      </g>

      {/* === Code editor card === */}
      <g transform="translate(28 178)" filter="url(#dv-shadow)">
        <rect width="240" height="134" rx="10" fill="url(#dv-panel)" stroke="#30394A" strokeWidth="1" />
        {/* window dots */}
        <g transform="translate(12 12)">
          <circle cx="0" cy="0" r="3" fill="#F87171" opacity="0.6" />
          <circle cx="10" cy="0" r="3" fill="#FBBF24" opacity="0.6" />
          <circle cx="20" cy="0" r="3" fill="#34D399" opacity="0.6" />
        </g>
        {/* file tabs sidebar */}
        <g fontFamily="ui-monospace, SFMono-Regular, monospace" fontSize="7" fill="#8B949E">
          <rect x="12" y="22" width="60" height="100" rx="3" fill="#0D1117" stroke="#30394A" strokeWidth="0.6" />
          <text x="18" y="34">src/</text>
          <rect x="14" y="38" width="56" height="9" rx="1.5" fill="#268CF5" opacity="0.18" />
          <text x="22" y="45" fill="#C9D1D9">client.py</text>
          <text x="22" y="55">service.py</text>
          <text x="22" y="65">config.py</text>
          <text x="18" y="78">v2/</text>
          <text x="22" y="88">api.py</text>
        </g>
        {/* code on right */}
        <g fontFamily="ui-monospace, SFMono-Regular, monospace" fontSize="8.5">
          <text x="82" y="34" fill="#A371F7">MAX_RETRIES</text>
          <text x="148" y="34" fill="#C9D1D9">= 5</text>
          <text x="82" y="46" fill="#A371F7">TIMEOUT_SEC</text>
          <text x="148" y="46" fill="#C9D1D9">= 60</text>
          <text x="82" y="58" fill="#A371F7">STATE</text>
          <text x="118" y="58" fill="#C9D1D9">=</text>
          <text x="126" y="58" fill="#7EE787">&quot;running&quot;</text>
          <text x="82" y="76" fill="#268CF5">def</text>
          <text x="100" y="76" fill="#C9D1D9">call_api():</text>
          <text x="90" y="88" fill="#FF7B72">for</text>
          <text x="108" y="88" fill="#C9D1D9">i</text>
          <text x="116" y="88" fill="#FF7B72">in</text>
          <text x="128" y="88" fill="#C9D1D9">range(MAX..)</text>
          <text x="90" y="100" fill="#FF7B72">try:</text>
          <text x="98" y="112" fill="#C9D1D9">request()</text>
          <text x="90" y="124" fill="#FF7B72">except</text>
        </g>
      </g>

      {/* arrows into engine */}
      <path d="M212,88 C260,88 260,160 296,160" fill="none" stroke="url(#dv-accent)" strokeWidth="2" markerEnd="url(#dv-arrow)" />
      <path d="M272,244 C290,244 290,200 296,200" fill="none" stroke="url(#dv-accent)" strokeWidth="2" markerEnd="url(#dv-arrow)" />

      {/* === Verifier engine === */}
      <g transform="translate(300 76)" filter="url(#dv-shadow)">
        <rect width="180" height="192" rx="14" fill="url(#dv-panel)" stroke="#268CF5" strokeOpacity="0.8" strokeWidth="1.4" />
        {/* circuit accents */}
        <g stroke="#268CF5" strokeOpacity="0.22" strokeWidth="0.8" fill="none">
          <path d="M10,36 L36,36 L36,52" />
          <path d="M170,36 L144,36 L144,52" />
          <path d="M10,156 L36,156 L36,140" />
          <path d="M170,156 L144,156 L144,140" />
        </g>
        <g fill="#268CF5" opacity="0.55">
          <circle cx="10" cy="36" r="1.4" />
          <circle cx="170" cy="36" r="1.4" />
          <circle cx="10" cy="156" r="1.4" />
          <circle cx="170" cy="156" r="1.4" />
        </g>
        <text x="90" y="26" textAnchor="middle" fontSize="12" fontWeight="700" fill="#C9D1D9" letterSpacing="0.5">
          Verifier
        </text>

        {/* gear assembly */}
        <g transform="translate(90 100)">
          <circle r="58" fill="none" stroke="#268CF5" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="3 4" />
          <Gear cx={-24} cy={-4} r={26} accent />
          <Gear cx={20} cy={14} r={18} />
          <Gear cx={32} cy={-22} r={12} accent />
        </g>

        <text x="90" y="168" textAnchor="middle" fontSize="9" fontWeight="700" fill="#268CF5" letterSpacing="0.4">
          DETERMINISTIC
        </text>
        <text x="90" y="180" textAnchor="middle" fontSize="8" fill="#8B949E">
          Verification engine
        </text>
      </g>

      {/* arrow engine -> drift report */}
      <line x1="486" y1="172" x2="540" y2="172" stroke="url(#dv-accent)" strokeWidth="2" markerEnd="url(#dv-arrow)" />

      {/* === Drift Report === */}
      <g transform="translate(548 50)" filter="url(#dv-shadow)">
        <rect width="190" height="244" rx="12" fill="url(#dv-amber-panel)" stroke="#F59E0B" strokeOpacity="0.55" strokeWidth="1" />
        {/* header band */}
        <rect width="190" height="56" rx="12" fill="url(#dv-amber-header)" />
        <rect y="48" width="190" height="8" fill="url(#dv-amber-header)" />
        <g transform="translate(14 16)">
          <path d="M14,0 L28,24 L0,24 Z" fill="rgba(245,158,11,0.3)" stroke="#F59E0B" strokeWidth="1.3" strokeLinejoin="round" />
          <text x="14" y="20" textAnchor="middle" fontSize="14" fontWeight="800" fill="#F59E0B">!</text>
        </g>
        <text x="50" y="26" fontSize="12" fontWeight="700" fill="#F59E0B">Drift Report</text>
        <text x="50" y="42" fontSize="9" fontWeight="700" fill="#F59E0B" letterSpacing="0.5">DRIFT DETECTED</text>

        {/* rows */}
        <ReportRow y={76} status="warn" label="retry_limit" note="expected 3, found 5" />
        <ReportRow y={128} status="warn" label="timeout_sec" note="expected 30, found 60" />
        <ReportRow y={180} status="ok" label="state" note="All checks passed" />
      </g>
    </svg>
  );
}

function ReportRow({
  y,
  status,
  label,
  note,
}: {
  y: number;
  status: 'ok' | 'warn';
  label: string;
  note: string;
}) {
  const color = status === 'ok' ? '#10B981' : '#F59E0B';
  const bg = status === 'ok' ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)';
  return (
    <g transform={`translate(14 ${y})`}>
      <rect width="162" height="44" rx="6" fill={bg} stroke={color} strokeOpacity="0.35" strokeWidth="0.8" />
      <g transform="translate(8 14)">
        {status === 'ok' ? (
          <g>
            <circle cx="8" cy="8" r="8" fill={color} opacity="0.18" />
            <circle cx="8" cy="8" r="6.5" fill={color} />
            <path d="M5,8.4 L7.2,10.6 L11,6.4" fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : (
          <g>
            <circle cx="8" cy="8" r="8" fill={color} opacity="0.18" />
            <circle cx="8" cy="8" r="6.5" fill={color} />
            <text x="8" y="11.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#FFFFFF">!</text>
          </g>
        )}
      </g>
      <text x="30" y="20" fontSize="10" fontWeight="600" fill="#C9D1D9" fontFamily="ui-monospace, SFMono-Regular, monospace">
        {label}
      </text>
      <text x="30" y="34" fontSize="8.5" fill="#8B949E">
        {note}
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
  const inner = r * 0.5;
  const points: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const angle = (i / (teeth * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r : r * 0.78;
    points.push(`${cx + Math.cos(angle) * rad},${cy + Math.sin(angle) * rad}`);
  }
  const stroke = accent ? '#268CF5' : '#8B949E';
  const fill = accent ? 'rgba(38,140,245,0.3)' : 'rgba(139,148,158,0.14)';
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
