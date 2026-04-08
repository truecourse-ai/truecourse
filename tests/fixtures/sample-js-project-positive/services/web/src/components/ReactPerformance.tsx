export function OptimizedList(): JSX.Element {
  return <div><p>List</p></div>;
}
export default function CardDisplay({ title, subtitle }: { readonly title: string; readonly subtitle: string }): JSX.Element {
  return <div><h2>{title}</h2><p>{subtitle}</p></div>;
}
