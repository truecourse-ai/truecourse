'use client';
export function Button(): JSX.Element {
  return <button type="button" className="inline-flex items-center">Click</button>;
}
export function Card(): JSX.Element {
  return <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"><h3 className="text-lg font-semibold">Title</h3></div>;
}
export function CloseIcon(): JSX.Element {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /></svg>;
}
export function Badge(): JSX.Element {
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">badge</span>;
}


// SVG branding icons. The `d` attribute on <path> is a string of geometric
// path coordinates, not network configuration. Substrings like "1.895.621.134"
// or "6.8.2.7" inside SVG path data are X/Y coordinates and curve control
// points emitted by design tools (Figma, Illustrator), and must not be flagged
// as hardcoded IP addresses. Each component below mirrors a real SVG icon
// shape found in the documenso codebase (branding-logo-icon, layout.shared,
// background) where the IP regex collides with path geometry.

// Mode: shape-7e50277b31cb
// Outer brand-mark path. Coordinate run "1.895.621.134" (and similar) is
// produced by SVG path compression where successive fractional decimals are
// concatenated without separators (".895.621.134" -> "X.Y Z.W" semantics).
export function BrandingLogoOuter(): JSX.Element {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.946 43.82v3.357c0 .97 0 1.866.006 2.698.038 4.787.295 7.418 2.027 9.15 1.731 1.732 4.362 1.988 9.15 2.026q1.246.009 2.697.007h10.411q1.45.002 2.697-.007c4.788-.038 7.419-.294 9.15-2.026 2.033-2.033 2.033-5.304 2.033-11.848V43.81l-3.384 3.67a2.9 2.9 0 0 0-.69 1.29c-.006 2.38-.038 4.033-.193 5.306l-.002.068-.008.008-.012.098c-.194 1.438-.489 1.762-.623 1.896-.133.133-.457.429-1.895.622l-.099.013-.008.008-.114.007c-.724.086-1.57.133-2.602.159l-2.32.141c-.661.04-1.288.305-1.778.75l-3.538 3.212h-3.697l-3.536-3.306a2.9 2.9 0 0 0-1.69-.769q-.41 0-.79-.004c-1.906-.016-3.288-.063-4.384-.21-1.439-.194-1.762-.49-1.896-.623-.134-.134-.429-.458-.622-1.896l-.009-.065-.012-.013-.002-.027-.004-.108c-.13-1.084-.171-2.442-.185-4.283l-.02-.472a2.9 2.9 0 0 0-.755-1.833zM57.01 32.35l.19 2.586c.049.652.315 1.27.757 1.751l3.16 3.447v-3.367c0-6.544 0-9.815-2.032-11.848s-5.305-2.033-11.848-2.033H43.85l3.391 3.09c.475.432 1.08.696 1.721.748l3.933.322q.562.033 1.045.085l.29.024.013.012.066.01c1.438.192 1.762.488 1.895.621.134.134.43.458.623 1.896.098.733.152 1.595.182 2.655" fill="currentColor" />
    </svg>
  );
}

// Mode: shape-73ebe4976d0b
// Inner brand-mark sibling path. Tight compressed run "013.002.027.012"
// is the tail of a relative cubic curve, not an octet sequence.
export function BrandingLogoInner(): JSX.Element {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="m27.226 54.158-.013-.013.002.027.012.013zM29.849 56.78l4.289.199c-1.852-.015-3.208-.06-4.29-.198M27.044 49.476a3 3 0 0 0-.08-.57 3 3 0 0 1 .04.376l.02.472c.014 1.84.056 3.2.185 4.283l.004.108.013.013zM17.915 41.972c0 2.45 1.679 4.491 5.038 7.903q-.009-1.246-.007-2.698v-3.344l-.001-1.861z" fill="currentColor" />
    </svg>
  );
}

// Mode: shape-48631517f555
// Decorative background wave. Many short coordinate triples in series produce
// IPv4-looking runs like "6.8.2.7" and "2.4.6.5" purely by accident.
export function BackgroundWave(): JSX.Element {
  return (
    <svg width="1440" height="320" viewBox="0 0 1440 320" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M708 195.8c.4-1.5.8-3.5 2-4.7 2-2 3 2.5 3.5 3.7.6 2 1.2 4.2 2.1 6.1 1.8 2.3 3.2-2.1 3.6-3.3.8-1.9 1.4-4.5 3-5.9 1.5-1.4 2.6 3.8 2.9 4.5.7 2 1 4.3 2 6.3 1 2.6 2.8-1 3.3-2.2.9-2 1.6-4.1 3-5.9 1.8-1.8 2.7 3 3 4 .4 2.2.9 4.5 1.7 6.7 1 2.6 2.3.9 3.2-.9 1-1.9 1.8-4.1 3.2-5.8 1.8-2.1 2.6 2.2 3 3.4" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}
