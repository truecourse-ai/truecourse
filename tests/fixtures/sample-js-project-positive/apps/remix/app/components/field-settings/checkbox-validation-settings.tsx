
// --- react-useless-set-state FP: multiple setState calls with locally derived vars (required + validationLength) ---
declare function useState<T>(init: T): [T, (v: T) => void];

type ValidationMeta = { required?: boolean; validationLength?: number; validationRule?: string };

function CheckboxValidationSettings({ initialMeta }: { initialMeta: ValidationMeta }) {
  const [required, setRequired] = useState(initialMeta.required ?? false);
  const [validationLength, setValidationLength] = useState(initialMeta.validationLength ?? 0);
  const [validationRule, setValidationRule] = useState(initialMeta.validationRule ?? '');

  const handleToggleChange = (field: keyof ValidationMeta, value: string | boolean) => {
    const required = field === 'required' ? Boolean(value) : Boolean(initialMeta.required);
    const validationRule = field === 'validationRule' ? String(value) : String(initialMeta.validationRule);
    const validationLength = field === 'validationLength' ? Number(value) : Number(initialMeta.validationLength);
    setRequired(required);
    setValidationRule(validationRule);
    setValidationLength(validationLength);
  };

  return <div>{required ? 'required' : 'optional'} max {validationLength}</div>;
}
