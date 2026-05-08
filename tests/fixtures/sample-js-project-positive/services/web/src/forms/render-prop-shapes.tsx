/**
 * Render-prop and function-as-children shapes that should NOT
 * fire on inline-function-in-jsx-prop. The function MUST be
 * inline because it closes over per-row state from the parent
 * render scope.
 */

declare const FormField: <T = unknown>(props: {
  name: string;
  render: (state: { field: { value: T; onChange: (v: T) => void } }) => JSX.Element;
}) => JSX.Element;

declare const VirtualList: (props: {
  items: string[];
  renderRow: (item: string, idx: number) => JSX.Element;
  renderHeader?: () => JSX.Element;
}) => JSX.Element;

declare const Controller: (props: {
  name: string;
  render: (state: { field: { value: string } }) => JSX.Element;
}) => JSX.Element;

export interface Output {
  form: JSX.Element;
  list: JSX.Element;
  ctrl: JSX.Element;
}

export function shapes(items: readonly string[]): Output {
  const form = (
    <FormField
      name="email"
      render={({ field }) => {
        const upper = String(field.value).toUpperCase();
        const onChange = (v: string) => field.onChange(v);
        return <input value={upper} onChange={(e) => onChange(e.target.value)} />;
      }}
    />
  );

  const list = (
    <VirtualList
      items={items}
      renderHeader={() => {
        const ts = Date.now();
        return <header>Header {ts}</header>;
      }}
      renderRow={(item, idx) => {
        const label = `${idx}: ${item}`;
        return <div key={item}>{label}</div>;
      }}
    />
  );

  const ctrl = (
    <Controller
      name="role"
      render={({ field }) => {
        const text = String(field.value);
        return <span>{text}</span>;
      }}
    />
  );

  return { form, list, ctrl };
}
