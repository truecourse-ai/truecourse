
// FP shape: React component with default string param in destructuring
declare function useFormContext(): { isTemplate: boolean };

type ConfigureViewProps = {
  mode?: 'document' | 'template';
  onSubmit: (data: Record<string, unknown>) => void;
  defaultValues?: Record<string, unknown>;
  readOnly?: boolean;
};

export const ConfigureView = ({
  mode = 'document',
  onSubmit,
  defaultValues,
  readOnly,
}: ConfigureViewProps) => {
  const { isTemplate } = useFormContext();
  const schemaKey = mode === 'template' ? 'templateSchema' : 'documentSchema';
  return null;
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;


// setState with mapped envelopeItems and remainingFields — valid state setter, no type mismatch
declare function setLocalEnvelope(patch: { envelopeItems?: Array<{ id: string; data: Uint8Array }>; fields?: Array<{ id: string; page: number; envelopeItemId: string }> }): void;
declare const envelopeItems: Array<{ id: string; data: Uint8Array }>;
declare const envelopeFields: Array<{ id: string; page: number; envelopeItemId: string }>;
declare const targetItemId: string;
declare const replacementData: Uint8Array;
declare const newPageCount: number;

export function applyPdfReplacement(): void {
  const remainingFields = envelopeFields.filter(
    (field) => field.envelopeItemId !== targetItemId || field.page <= newPageCount,
  );

  setLocalEnvelope({
    envelopeItems: envelopeItems.map((item) =>
      item.id === targetItemId ? { ...item, data: replacementData } : item,
    ),
    fields: remainingFields,
  });
}

