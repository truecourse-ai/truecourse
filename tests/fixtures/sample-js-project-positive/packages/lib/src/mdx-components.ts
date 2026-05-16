
// --- explicit-any-in-return shape: unclassified ---
// getMDXComponents returns `any` because the spread of external MDX component
// maps produces a type that is structurally incompatible with the strict
// MDXComponents interface — using any here is the documented upstream pattern.
declare const defaultMdxComponents: Record<string, unknown>;
declare const TabsComponents: Record<string, unknown>;
declare type MDXComponents = Record<string, unknown>;
declare function MermaidDiagram(props: { chart: string }): JSX.Element;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMDXComponents(components?: MDXComponents): any {
  return {
    ...defaultMdxComponents,
    ...TabsComponents,
    MermaidDiagram,
    ...components,
  };
}
