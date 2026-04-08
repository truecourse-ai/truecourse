export function SafeHook(): JSX.Element { return <div>Safe</div>; }
export function StableDep(): JSX.Element { return <div>Stable</div>; }
export function AccessibleTable(): JSX.Element {
  return (<table><thead><tr><th>Column</th></tr></thead><tbody><tr><td>Row</td></tr></tbody></table>);
}
