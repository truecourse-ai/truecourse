/**
 * A sailboat side-on, drawn in a 100-unit square: the hull sits in the water
 * at y=80, so the point (50, 80) is where it rides the line. A mast, a bellied
 * mainsail aft of it, the jib forward of it in the brand's green, and a
 * pennant at the top. Coloured by the page's tokens.
 */
export function BoatGlyph() {
  return (
    <>
      <path className="boat-hull" d="M10 74 Q 50 79 90 73 L 84 90 Q 50 95 18 89 Z" />
      <path className="boat-main" d="M50 8 Q 30 44 24 70 L 50 70 Z" />
      <path className="boat-jib" d="M50 12 Q 74 44 86 71 L 53 71 Z" />
      <line className="boat-mast" x1="50" y1="76" x2="50" y2="4" />
      <path className="boat-pennant" d="M50 4 L 60 7.5 L 50 11 Z" />
    </>
  );
}
