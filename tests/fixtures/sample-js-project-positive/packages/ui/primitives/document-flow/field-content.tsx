
declare const useLingui7: () => { _: (msg: unknown) => string };
declare const cn7: (...classes: unknown[]) => string;
declare const Checkbox7: React.ComponentType<{ className?: string; disabled?: boolean; checked?: boolean; onCheckedChange?: (v: boolean) => void }>;
declare const Label7: React.ComponentType<{ className?: string; children: React.ReactNode }>;
declare const RadioGroup7: React.ComponentType<{ className?: string; value?: string; children: React.ReactNode }>;
declare const RadioGroupItem7: React.ComponentType<{ value: string; className?: string; disabled?: boolean }>;
declare const ChevronDownIcon7: React.ComponentType<{ className?: string }>;

type WidgetFieldType = 'CHECKBOX' | 'RADIO' | 'DROPDOWN' | 'TEXT' | 'DATE';

type WidgetFieldMeta =
  | { type: 'checkbox'; values?: string[]; direction?: 'horizontal' | 'vertical' }
  | { type: 'radio'; options?: string[] }
  | { type: 'dropdown'; options?: string[] }
  | null;

type WidgetField = {
  inserted?: boolean;
  customText?: string;
  type: WidgetFieldType;
  fieldMeta?: WidgetFieldMeta;
};

/**
 * Renders the preview content inside a widget field container before finalizing.
 */
export const WidgetFieldContent = ({ field }: { field: WidgetField }) => {
  const { _ } = useLingui7();

  const { type, fieldMeta } = field;

  if (field.type === 'CHECKBOX' && field.fieldMeta?.type === 'checkbox') {
    let checkedValues: string[] = [];

    try {
      checkedValues = JSON.parse(field.customText ?? '[]');
    } catch {
      // do nothing
    }

    if (!field.fieldMeta.values || field.fieldMeta.values.length === 0) {
      return (
        <div
          className={cn7(
            'flex gap-1 py-0.5',
            field.fieldMeta.direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col gap-y-1',
          )}
        >
          <div className="flex items-center">
            <Checkbox7 className="h-3 w-3" disabled />
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn7(
          'flex gap-1 py-0.5',
          field.fieldMeta.direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col gap-y-1',
        )}
      >
        {field.fieldMeta.values.map((option, idx) => (
          <div key={idx} className="flex items-center gap-1">
            <Checkbox7 className="h-3 w-3" checked={checkedValues.includes(option)} disabled />
            <Label7 className="text-xs">{option}</Label7>
          </div>
        ))}
      </div>
    );
  }

  if (field.type === 'RADIO' && field.fieldMeta?.type === 'radio') {
    if (!field.fieldMeta.options || field.fieldMeta.options.length === 0) {
      return (
        <div className="flex items-center gap-1 py-0.5">
          <RadioGroup7 value="">
            <RadioGroupItem7 value="placeholder" disabled />
          </RadioGroup7>
        </div>
      );
    }

    return (
      <RadioGroup7 value={field.customText ?? ''} className="flex flex-col gap-1 py-0.5">
        {field.fieldMeta.options.map((option, idx) => (
          <div key={idx} className="flex items-center gap-1">
            <RadioGroupItem7 value={option} />
            <Label7 className="text-xs">{option}</Label7>
          </div>
        ))}
      </RadioGroup7>
    );
  }

  if (field.type === 'DROPDOWN' && field.fieldMeta?.type === 'dropdown') {
    return (
      <div className="flex items-center justify-between gap-1 px-1 py-0.5 text-xs">
        <span>{field.customText || field.fieldMeta.options?.[0] || ''}</span>
        <ChevronDownIcon7 className="h-3 w-3 flex-shrink-0" />
      </div>
    );
  }

  return <p className="text-xs">{field.customText ?? ''}</p>;
};
