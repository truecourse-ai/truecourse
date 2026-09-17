/** The shoreline across the top of the water, drawn past both edges. */
const SHORE = 'M-40 -20 H1480 V38 C 1300 72, 1120 26, 940 52 S 600 84, 420 48 S 120 30, -40 62 Z';
/** A line of swell seen from above, drawn past both edges so it can drift. */
const SWELL = 'M-240 0 C -120 -8, 0 8, 120 0 S 360 -8, 480 0 S 720 8, 840 0 S 1080 -8, 1200 0 S 1440 8, 1560 0 S 1680 -8, 1680 0';

/**
 * The sea from above: the beach along the top edge, wet sand and a line of
 * foam where the water meets it, and the water deepening away from the shore
 * with lines of swell crossing it on their own slow drifts.
 */
export function Shore() {
  return (
    <svg className="shore" viewBox="0 0 1440 300" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="shore-depth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.9 0.05 230)" />
          <stop offset="1" stopColor="oklch(0.8 0.085 240)" />
        </linearGradient>
        <filter id="shore-foam" x="-5%" y="-40%" width="110%" height="180%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <linearGradient id="shore-sand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.955 0.028 85)" />
          <stop offset="1" stopColor="oklch(0.93 0.04 82)" />
        </linearGradient>
        <filter id="shore-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="noise" />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0.45  0 0 0 0 0.35  0 0 0 0 0.2  0 0 0 0.16 0"
            result="specks"
          />
          <feComposite in="specks" in2="SourceGraphic" operator="in" result="grain" />
          <feBlend in="SourceGraphic" in2="grain" mode="multiply" />
        </filter>
      </defs>
      <rect width="1440" height="300" fill="url(#shore-depth)" />
      {[110, 150, 190, 230, 270].map((y, i) => (
        <path key={y} className={`shore-swell shore-swell-${i % 3}`} d={SWELL} transform={`translate(0 ${y})`} />
      ))}
      <path className="shore-wet" d={SHORE} transform="translate(0 12)" />
      <path className="shore-sand" d={SHORE} fill="url(#shore-sand)" filter="url(#shore-grain)" />
      <path className="shore-foam" d={SHORE} filter="url(#shore-foam)" />
    </svg>
  );
}
