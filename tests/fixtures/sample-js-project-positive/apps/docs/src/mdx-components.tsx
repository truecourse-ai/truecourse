
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MDXComponents = Record<string, any>;

declare const defaultComponents: MDXComponents;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useMDXComponents(components: MDXComponents): any {
  return { ...defaultComponents, ...components };
}
