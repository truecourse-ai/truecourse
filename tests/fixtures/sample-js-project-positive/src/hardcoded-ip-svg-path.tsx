/**
 * Positive fixture for security/deterministic/hardcoded-ip.
 *
 * SVG `<path d="...">` coordinate strings contain long sequences of
 * decimal numbers separated by `.`, `-` and spaces. The IPv4 regex can
 * snap onto a four-octet-shaped substring inside such a sequence (e.g.
 * `013.002.027.012` within `.013.002.027.012.013`). The match is not an
 * IP — it's part of a longer numeric path command. The rule must not
 * fire on these.
 */

export function BrandMark(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.946 43.82v3.357c0 .97 0 1.866.006 2.698.038 4.787.295 7.418 2.027 9.15 1.731 1.731z" />
      <path d="m27.226 54.158-.013-.013.002.027.012.013zM29.849 56.78l4.289.199c-1.852-.015-3.208-.064z" />
    </svg>
  );
}
