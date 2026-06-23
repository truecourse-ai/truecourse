/**
 * Positive fixture for bugs/deterministic/generic-error-message.
 *
 * A vague headline in a `title` JSX attribute is acceptable when a sibling
 * attribute (`message`/`description`/...) carries the actionable detail — the
 * user still sees something useful. The rule must not flag the title in
 * isolation, mirroring its existing object-literal title+description carve-out.
 */

function InfoCard(props: { readonly title: string; readonly message: string }): JSX.Element {
  return (
    <div>
      {props.title}
      {props.message}
    </div>
  );
}

export function FailureBanner(props: { readonly detail: string }): JSX.Element {
  return <InfoCard title="Oops" message={props.detail} />;
}
