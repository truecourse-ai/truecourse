/**
 * type-guard-preference shape that should NOT fire:
 *
 * React functional component (PascalCase, returns JSX) that
 * happens to contain a `typeof window !== "undefined"` SSR
 * guard. The function is a component — its return type is JSX,
 * not boolean — and the typeof check is inside a conditional,
 * not the function's primary purpose.
 */

interface ViewOptionsProps {
  readonly markdownUrl: string;
  readonly githubUrl: string;
}

export function ViewOptions({ markdownUrl, githubUrl }: ViewOptionsProps): JSX.Element {
  const onServer = typeof window === "undefined";
  const onClient = !onServer;
  return (
    <div>
      <a href={markdownUrl}>Markdown</a>
      <a href={githubUrl}>GitHub</a>
      {onClient && <span>client-only marker</span>}
    </div>
  );
}
