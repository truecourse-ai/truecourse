/** The wave the boat rides, in a 1440 by 160 box. */
export const WAVE = 'M0 108 C 380 108, 600 74, 840 94 S 1240 138, 1440 116';
/** The waves under it: the same curve drawn past both edges so they can drift. */
export const SWELL = 'M-240 110 C 140 110, 360 78, 600 96 S 1000 140, 1200 118 S 1560 92, 1680 104';

/**
 * The water as four layers, the top one the wave the boat rides and each
 * lower one a little deeper in colour, drifting on its own period. Drawn in
 * the box of the SVG that holds it, offset by `y`.
 */
export function Waves({ y = 0 }: { y?: number }) {
  return (
    <g className="waves" transform={`translate(0 ${y})`}>
      <path className="water water-0" d={`${WAVE} L1440 400 L0 400 Z`} />
      <path className="water water-1" d={`${SWELL} L1680 400 L-240 400 Z`} transform="translate(0 24)" />
      <path className="water water-2" d={`${SWELL} L1680 400 L-240 400 Z`} transform="translate(0 50)" />
      <path className="water water-3" d={`${SWELL} L1680 400 L-240 400 Z`} transform="translate(0 78)" />
    </g>
  );
}
