/**
 * The mark's twin sails as a line glyph, drawn in a 100-unit square: the hull
 * rests on y=80, the sails stand from y=8. Coloured by the page's tokens.
 */
export function BoatGlyph() {
  return (
    <>
      <polygon className="boat-main" points="46,8 46,66 14,66" />
      <polygon className="boat-jib" points="54,22 54,66 82,66" />
      <path className="boat-hull" d="M26 80 H74" strokeWidth={7} strokeLinecap="round" />
    </>
  );
}
