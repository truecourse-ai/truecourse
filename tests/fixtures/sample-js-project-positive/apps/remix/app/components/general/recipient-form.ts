
// FP: useCallback returns an async function; form.setValue returns void and result is discarded.
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;

type DropResult = { destination: { index: number } | null; source: { index: number } };
type Signer = { id: string; email: string; signingOrder: number };

declare const form: {
  setValue: (field: string, value: Signer[], opts: { shouldValidate: boolean; shouldDirty: boolean }) => void;
  getValues: () => { signers: Signer[] };
};

const onDragEnd = useCallback(
  async (result: DropResult) => {
    if (!result.destination) {
      return;
    }

    const items = [...form.getValues().signers];
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved!);

    const reordered = items.map((s, i) => ({ ...s, signingOrder: i + 1 }));

    form.setValue('signers', reordered, {
      shouldValidate: true,
      shouldDirty: true,
    });
  },
  [],
);
