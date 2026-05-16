
// --- redundant-type-alias FP: exported component prop type aliasing library type ---
// Exported public API alias decouples consumers from the underlying primitive library
declare namespace SelectPrimitive { interface SelectProps { value?: string; onValueChange?: (v: string) => void; disabled?: boolean; children?: unknown } }

export type TemplateTypeSelectProps = SelectPrimitive.SelectProps;

declare function forwardRef<T, P>(fn: (props: P, ref: unknown) => JSX.Element): (props: P & { ref?: unknown }) => JSX.Element;

export const TemplateTypeSelect = forwardRef<HTMLButtonElement, TemplateTypeSelectProps>(({ ...props }, ref) => {
  return <div />;
});
