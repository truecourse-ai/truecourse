/**
 * Positive fixture for code-quality/deterministic/required-type-annotations.
 *
 * `export const fn: SomeFunctionType = (a, b) => …` types the variable as a
 * function type. TypeScript infers each parameter's type from the contextual
 * function type, so per-parameter annotations are redundant. The visitor must
 * not flag parameters when the variable declarator itself carries a type
 * annotation.
 */

type LoaderFn<T> = (input: { id: string }, init?: { status?: number }) => T;

interface ItemProps {
  readonly title: string;
  readonly subtitle: string;
}

type ItemComponent = (props: ItemProps) => string;

export const loadItem: LoaderFn<{ status: string }> = (input, init = {}) => {
  const status = init.status ? String(init.status) : input.id;
  return { status };
};

export const renderItem: ItemComponent = ({ title, subtitle }) => {
  return title + subtitle;
};
