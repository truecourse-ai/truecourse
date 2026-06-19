// CSS fallback values supplied inside JSX `{…}` child expressions. A viewport
// height and a background size are presentation literals, not domain constants
// worth extracting to a named value — repeating them as layout fallbacks inside
// JSX markup is idiomatic, so this must not be flagged as a duplicate string.

interface RowProps {
  readonly height: string | null;
  readonly size: string | null;
}

export function Row({ height, size }: RowProps): JSX.Element {
  return (
    <ul>
      <li>{height ?? "100vh"}</li>
      <li>{height ?? "100vh"}</li>
      <li>{height ?? "100vh"}</li>
      <li>{size ?? "260px auto"}</li>
      <li>{size ?? "260px auto"}</li>
      <li>{size ?? "260px auto"}</li>
    </ul>
  );
}
