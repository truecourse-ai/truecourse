// True bug: untrusted, unescaped HTML rendered via
// `dangerouslySetInnerHTML`. The `bannerHtml` prop comes from a CMS
// field that admins can edit — any HTML/script they paste flows
// straight into the DOM, bypassing React's auto-escaping.

type DangerouslyUserContentProps = {
  bannerHtml: string;
};

export function DangerouslyUserContent({ bannerHtml }: DangerouslyUserContentProps): JSX.Element {
  return (
    <div
      className="banner"
      // VIOLATION: security/deterministic/disabled-auto-escaping
      dangerouslySetInnerHTML={{ __html: bannerHtml }}
    />
  );
}
