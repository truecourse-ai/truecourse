
// --- react-useless-set-state FP: setValidationRule uses locally computed var from ternary ---
declare function useState<T>(init: T): [T, (v: T) => void];

type RuleMeta = { required?: boolean; validationRule?: string };

function CheckboxRuleSettings({ initialMeta }: { initialMeta: RuleMeta }) {
  const [required, setRequired] = useState(initialMeta.required ?? false);
  const [validationRule, setValidationRule] = useState(initialMeta.validationRule ?? '');

  const handleRuleChange = (field: keyof RuleMeta, value: string | boolean) => {
    const validationRule = field === 'validationRule' ? String(value) : String(initialMeta.validationRule);
    const required = field === 'required' ? Boolean(value) : Boolean(initialMeta.required);
    setValidationRule(validationRule);
    setRequired(required);
  };

  return <div><input value={validationRule} onChange={(e) => handleRuleChange('validationRule', e.target.value)} /></div>;
}
