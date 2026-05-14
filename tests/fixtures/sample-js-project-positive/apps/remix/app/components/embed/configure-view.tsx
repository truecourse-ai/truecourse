
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
