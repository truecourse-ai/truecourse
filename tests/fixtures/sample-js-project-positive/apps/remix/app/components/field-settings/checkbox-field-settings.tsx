
// --- react-useless-set-state FP: setReadOnly(readOnly) uses locally computed var ---
declare function useState<T>(init: T): [T, (v: T) => void];

type CheckboxMeta = { readOnly?: boolean; required?: boolean; validationLength?: number; validationRule?: string };

function CheckboxFieldSettings({ initialMeta }: { initialMeta: CheckboxMeta }) {
  const [readOnly, setReadOnly] = useState(initialMeta.readOnly ?? false);
  const [required, setRequired] = useState(initialMeta.required ?? false);
  const [validationLength, setValidationLength] = useState(initialMeta.validationLength ?? 0);
  const [validationRule, setValidationRule] = useState(initialMeta.validationRule ?? '');

  const handleToggleChange = (field: keyof CheckboxMeta, value: string | boolean) => {
    const readOnly = field === 'readOnly' ? Boolean(value) : Boolean(initialMeta.readOnly);
    const required = field === 'required' ? Boolean(value) : Boolean(initialMeta.required);
    setReadOnly(readOnly);
    setRequired(required);
  };

  return <div>{readOnly ? 'readonly' : 'editable'}</div>;
}
