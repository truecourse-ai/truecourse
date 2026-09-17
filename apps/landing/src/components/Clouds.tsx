/**
 * A sky: a few soft clouds, each a cluster of blurred ellipses, white on the
 * blue, drifting so slowly the eye only catches it on a second look, and the
 * wind crossing it left to right as thin streaks.
 */
const CLOUDS: { x: number; y: number; s: number; cls: string }[] = [
  { x: 170, y: 120, s: 1.05, cls: 'cloud-a' },
  { x: 1220, y: 90, s: 1.3, cls: 'cloud-b' },
  { x: 720, y: 70, s: 0.65, cls: 'cloud-c' },
  { x: 420, y: 250, s: 0.8, cls: 'cloud-b' },
  { x: 1040, y: 230, s: 0.9, cls: 'cloud-a' },
  { x: -30, y: 320, s: 0.7, cls: 'cloud-c' },
  { x: 1400, y: 340, s: 0.6, cls: 'cloud-a' },
];

/**
 * The wind: gusts crossing the sky left to right, each two or three streaks
 * of their own shape and length that set off together and drift apart, each
 * on its own pace. Drawn from a fixed sequence so the prerender and the
 * browser agree.
 */
interface Streak {
  dy: number;
  x: number;
  len: number;
  amp: number;
  w: number;
  dur: number;
}
interface Gust {
  y: number;
  delay: number;
  lines: Streak[];
}

function gusts(): Gust[] {
  let seed = 11;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out: Gust[] = [];
  const rows = [60, 140, 215, 290, 360, 420];
  for (const y of rows) {
    const count = rand() < 0.4 ? 2 : 3;
    const base = 11 + rand() * 10;
    const lines: Streak[] = [];
    for (let i = 0; i < count; i++) {
      lines.push({
        dy: i === 0 ? 0 : (i === 1 ? -1 : 1) * (9 + rand() * 8),
        x: i === 0 ? 0 : 20 + rand() * 90,
        len: i === 0 ? 180 + rand() * 180 : 80 + rand() * 120,
        amp: 3 + rand() * 7,
        w: i === 0 ? 1.5 + rand() * 0.5 : 1 + rand() * 0.4,
        dur: base * (0.88 + rand() * 0.24),
      });
    }
    out.push({ y, delay: -rand() * base, lines });
  }
  return out;
}
const GUSTS = gusts();

function streak(len: number, amp: number): string {
  const a = len / 4;
  return `M0 0 C ${a} ${-amp}, ${a * 2} ${amp}, ${a * 3} 0 S ${len} ${-amp * 0.7}, ${len} 0`;
}

export function Clouds({ className = '' }: { className?: string }) {
  return (
    <svg className={`clouds ${className}`} viewBox="0 0 1440 420" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <defs>
        <filter id="cloud-soft" x="-30%" y="-60%" width="160%" height="220%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>
      {GUSTS.map((g) => (
        <g key={g.y} transform={`translate(0 ${g.y})`}>
          {g.lines.map((l, i) => (
            <path
              key={i}
              className="gust"
              d={streak(l.len, l.amp)}
              transform={`translate(${l.x} ${l.dy})`}
              strokeWidth={l.w}
              style={{ ['--dur' as string]: `${l.dur.toFixed(2)}s`, ['--delay' as string]: `${g.delay.toFixed(2)}s` }}
            />
          ))}
        </g>
      ))}
      {CLOUDS.map((c) => (
        <g key={`${c.x}-${c.y}`} className={`cloud ${c.cls}`} transform={`translate(${c.x} ${c.y}) scale(${c.s})`} filter="url(#cloud-soft)">
          <ellipse cx="0" cy="0" rx="120" ry="30" />
          <ellipse cx="-50" cy="-14" rx="70" ry="34" />
          <ellipse cx="40" cy="-22" rx="80" ry="40" />
          <ellipse cx="110" cy="-6" rx="60" ry="28" />
        </g>
      ))}
    </svg>
  );
}
