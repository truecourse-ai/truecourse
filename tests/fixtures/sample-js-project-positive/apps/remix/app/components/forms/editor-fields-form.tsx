
// FP shape fa0ade83a888: useCallback wrapping addField with nanoid and spread — no type mismatch
declare function useCallback<T extends Function>(fn: T, deps: unknown[]): T;
declare function nanoid(size?: number): string;
declare function append(item: object): void;
declare function triggerFieldsUpdate(): void;
declare function restrictFieldPosValues(data: object): object;

type LocalField = { formId: string; type: string; x: number; y: number; width: number; height: number; page: number };

const addField = useCallback(
  (fieldData: Omit<LocalField, 'formId'>): LocalField => {
    const field: LocalField = {
      ...fieldData,
      formId: nanoid(12),
      ...restrictFieldPosValues(fieldData),
    };

    append(field);
    triggerFieldsUpdate();
    return field;
  },
  [],
);
