
declare const cn: (...args: any[]) => string;
declare const format: (date: Date, fmt: string) => string;
declare const CheckSquare: any;
declare const Square: any;
declare const Calendar: any;
declare const Type: any;
declare const AtSign: any;
declare const Hash: any;

type FieldType = 'TEXT' | 'EMAIL' | 'DATE' | 'CHECKBOX' | 'NUMBER' | 'SIGNATURE' | 'INITIALS';

type ReadOnlyField = {
  id: string;
  type: FieldType;
  label?: string;
  value: string | null;
  required: boolean;
  page: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
};

const FIELD_ICONS: Record<FieldType, any> = {
  TEXT: Type,
  EMAIL: AtSign,
  DATE: Calendar,
  CHECKBOX: CheckSquare,
  NUMBER: Hash,
  SIGNATURE: Type,
  INITIALS: Type,
};

type FieldValueDisplayProps = { field: ReadOnlyField };

function FieldValueDisplay({ field }: FieldValueDisplayProps) {
  const Icon = FIELD_ICONS[field.type] ?? Type;

  if (field.type === 'CHECKBOX') {
    const checked = field.value === 'true';
    return (
      <div className="flex items-center gap-2">
        {checked ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm">{field.label ?? (checked ? 'Checked' : 'Unchecked')}</span>
      </div>
    );
  }

  if (field.type === 'DATE' && field.value) {
    const parsed = new Date(field.value);
    return (
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">
          {Number.isNaN(parsed.getTime()) ? field.value : format(parsed, 'MMMM d, yyyy')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className={cn('text-sm', { 'text-muted-foreground italic': !field.value })}>
        {field.value ?? 'Not filled'}
      </span>
    </div>
  );
}

type DocumentReadOnlyFieldsProps = {
  fields: ReadOnlyField[];
  className?: string;
};

export function DocumentReadOnlyFields({ fields, className }: DocumentReadOnlyFieldsProps) {
  const byPage = fields.reduce<Record<number, ReadOnlyField[]>>((acc, f) => {
    const group = acc[f.page] ?? [];
    group.push(f);
    acc[f.page] = group;
    return acc;
  }, {});

  const pages = Object.keys(byPage)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className={cn('space-y-6', className)}>
      {pages.map((page) => (
        <div key={page}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Page {page}
          </p>

          <div className="space-y-3">
            {byPage[page].map((field) => (
              <div
                key={field.id}
                className={cn(
                  'rounded-md border p-3',
                  field.value ? 'border-border' : 'border-dashed border-muted-foreground/40',
                )}
              >
                {field.label && (
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {field.label}
                    {field.required && <span className="ml-1 text-destructive">*</span>}
                  </p>
                )}

                <FieldValueDisplay field={field} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
