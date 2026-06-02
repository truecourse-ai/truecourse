/**
 * Positive fixture for architecture/deterministic/god-module.
 *
 * A primitive component file (DateTime, Select, Badge, Panel-collection)
 * naturally ships many small PascalCase sub-components — format variants,
 * Radix-shaped slot wrappers, layout shells. They share state, styling
 * tokens, or composition context, so splitting them across files would
 * shred the single conceptual unit. The god-module heuristic
 * (>15 methods) treats every export as a business method and fires.
 */

interface PanelProps {
  readonly title: string;
  readonly body?: string;
}

interface HeaderProps {
  readonly title: string;
}

interface BodyProps {
  readonly body?: string;
}

interface FooterProps {
  readonly tag?: string;
}

export function PanelHeader(p: HeaderProps): JSX.Element {
  return <h2>{p.title}</h2>;
}
export function PanelBody(p: BodyProps): JSX.Element {
  return <div>{p.body ?? ''}</div>;
}
export function PanelFooter(p: FooterProps): JSX.Element {
  return <footer>{p.tag ?? ''}</footer>;
}
export function PanelShell(p: PanelProps): JSX.Element {
  return (
    <section>
      <PanelHeader title={p.title} />
      <PanelBody body={p.body} />
      <PanelFooter />
    </section>
  );
}
export function PanelEmpty(): JSX.Element { return <PanelShell title="empty" />; }
export function PanelLoading(): JSX.Element { return <PanelShell title="loading" />; }
export function PanelError(): JSX.Element { return <PanelShell title="error" />; }
export function PanelInfo(): JSX.Element { return <PanelShell title="info" />; }
export function PanelSuccess(): JSX.Element { return <PanelShell title="success" />; }
export function PanelWarning(): JSX.Element { return <PanelShell title="warning" />; }
export function PanelDestructive(): JSX.Element { return <PanelShell title="destructive" />; }
export function PanelMuted(): JSX.Element { return <PanelShell title="muted" />; }
export function PanelHighlight(): JSX.Element { return <PanelShell title="highlight" />; }
export function PanelOutline(): JSX.Element { return <PanelShell title="outline" />; }
export function PanelGhost(): JSX.Element { return <PanelShell title="ghost" />; }
export function PanelLink(): JSX.Element { return <PanelShell title="link" />; }
export function PanelInline(): JSX.Element { return <PanelShell title="inline" />; }
export function PanelBlock(): JSX.Element { return <PanelShell title="block" />; }
export function PanelCompact(): JSX.Element { return <PanelShell title="compact" />; }
