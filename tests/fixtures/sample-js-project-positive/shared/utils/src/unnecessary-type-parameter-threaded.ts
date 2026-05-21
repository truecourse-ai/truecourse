// Type parameters that thread type information through generic
// applications. Each tparam appears textually once, but inside another
// generic — removing it would change the instantiation and break the
// caller's inference.

type JobDefinition<N extends string, T> = {
  id: string;
  trigger: { name: N; payload: T };
};

type ListProps<TRow> = {
  rows: TRow[];
  renderRow: (row: TRow) => string;
};

type FieldPath<TForm> = keyof TForm & string;
type FieldRenderProps<TForm, TName extends FieldPath<TForm>> = {
  name: TName;
  value: TForm[TName];
};

export function defineJob<N extends string, T>(definition: JobDefinition<N, T>): string {
  return definition.id;
}

export function renderList<TRow>(props: ListProps<TRow>): number {
  return props.rows.length;
}

export function renderField<TForm, TName extends FieldPath<TForm>>(
  props: FieldRenderProps<TForm, TName>,
): string {
  return String(props.name);
}
