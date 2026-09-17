/**
 * A line of water under a title, as wide as the title: waves in the crest's
 * blue, drawn long and cut to the width of the block that holds it. Inside a
 * reveal it draws on as the block comes into view; elsewhere it is simply
 * there.
 */
const WAVES = 60;
const PERIOD = 22;

function path(): string {
  let d = `M2 5`;
  for (let i = 0; i < WAVES; i++) {
    const x = 2 + i * PERIOD;
    d += ` C ${x + 4} 1, ${x + 7} 1, ${x + 11} 5 S ${x + 18} 9, ${x + PERIOD} 5`;
  }
  return d;
}
const D = path();

export function WaveRule() {
  return (
    <svg
      className="wave-rule"
      viewBox={`0 0 ${WAVES * PERIOD + 4} 10`}
      height="10"
      preserveAspectRatio="xMinYMid slice"
      aria-hidden="true"
    >
      <path d={D} pathLength={1} />
    </svg>
  );
}
