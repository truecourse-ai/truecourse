
declare const AppError: any;
declare const AppErrorCode: any;
declare const match: any;

type Field = { id: string; type: string; fieldMeta?: any };
type PrefillEntry = { type: string; value: unknown };

function applyPrefillToField(field: Field, prefill?: PrefillEntry) {
  if (!prefill) return field.fieldMeta;

  const isAdvanced = ['TEXT', 'NUMBER', 'CHECKBOX', 'RADIO', 'SELECT'].includes(field.type);
  if (!isAdvanced) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: `Field ${field.id} cannot have prefill meta.`,
    });
  }

  const existing = field.fieldMeta || {};

  return match(prefill)
    .with({ type: 'text' }, (p: any) => {
      if (typeof p.value !== 'string') {
        throw new AppError(AppErrorCode.INVALID_BODY, {
          message: `Invalid value for TEXT field ${field.id}: expected string, got ${typeof p.value}`,
        });
      }
      return { ...existing, type: 'text', text: p.value };
    })
    .with({ type: 'number' }, (p: any) => {
      if (typeof p.value !== 'string') {
        throw new AppError(AppErrorCode.INVALID_BODY, {
          message: `Invalid value for NUMBER field ${field.id}: expected string, got ${typeof p.value}`,
        });
      }
      return { ...existing, type: 'number', value: p.value };
    })
    .otherwise(() => existing);
}
