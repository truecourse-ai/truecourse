declare const useController: (opts: { name: string; control: unknown }) => { field: { value: boolean; onChange: (v: boolean) => void; ref: React.Ref<unknown> } };
declare const cn: (...args: unknown[]) => string;
declare const Checkbox: (props: { id?: string; checked?: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean; className?: string; ref?: React.Ref<unknown> }) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode; className?: string }) => JSX.Element;
declare const FieldCard: (props: { children: React.ReactNode; className?: string; isRequired?: boolean }) => JSX.Element;
declare const Tooltip: (props: { children: React.ReactNode }) => JSX.Element;
declare const TooltipTrigger: (props: { children: React.ReactNode; asChild?: boolean }) => JSX.Element;
declare const TooltipContent: (props: { children: React.ReactNode }) => JSX.Element;

type CheckboxFieldSignProps = {
  name: string;
  control: unknown;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  tooltip?: string;
  className?: string;
};

export function CheckboxFieldSign({
  name,
  control,
  label,
  required = false,
  disabled = false,
  tooltip,
  className,
}: CheckboxFieldSignProps) {
  const { field } = useController({ name, control });

  const checkbox = (
    <div className={cn('flex items-start gap-3', className)}>
      <Checkbox
        id={`field-${name}`}
        checked={field.value}
        onCheckedChange={field.onChange}
        disabled={disabled}
        ref={field.ref}
        className="mt-0.5"
      />
      {label && (
        <Label
          htmlFor={`field-${name}`}
          className={cn('text-sm leading-snug', {
            'cursor-not-allowed opacity-50': disabled,
          })}
        >
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
      )}
    </div>
  );

  if (tooltip) {
    return (
      <FieldCard isRequired={required}>
        <Tooltip>
          <TooltipTrigger asChild>{checkbox}</TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </FieldCard>
    );
  }

  return <FieldCard isRequired={required}>{checkbox}</FieldCard>;
}
