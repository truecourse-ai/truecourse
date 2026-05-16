
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

function _longFn_51903c38(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
