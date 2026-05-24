// Positive: security/deterministic/disabled-auto-escaping
//
// `dangerouslySetInnerHTML` with a static string or template (no
// substitutions) cannot inject untrusted content — the HTML is fully
// known at compile time. Same goes for values that go through a
// recognized escape/sanitize helper. The rule should not flag these.
//
// Lives under `/app/` so it's treated as a server component — the
// orthogonal `inline-object-in-jsx-prop` perf rule (which fires on the
// inline `{{ __html: … }}` shape) does not apply to server components.

declare function escapeHtml(s: string): string;
declare function sanitize(s: string): string;

export function NoFlashStyles(): JSX.Element {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
      }}
    />
  );
}

export function AboutBlurb(): JSX.Element {
  return <p dangerouslySetInnerHTML={{ __html: '<strong>About</strong> us' }} />;
}

export function UserBio({ raw }: { raw: string }): JSX.Element {
  return <div dangerouslySetInnerHTML={{ __html: sanitize(raw) }} />;
}

export function GreetingBanner({ name }: { name: string }): JSX.Element {
  return <span dangerouslySetInnerHTML={{ __html: `Hi, ${escapeHtml(name)}!` }} />;
}
