// A React component that takes no props can annotate its props parameter as
// `{}`. The framework constructs the props bag, so the "`{}` matches everything
// non-nullish" footgun does not apply — this is the idiomatic "no props"
// annotation, not a type bug.

export function WelcomeBanner(props: {}): JSX.Element {
  const provided = Object.keys(props).length;
  return <div>Welcome ({provided})</div>;
}
