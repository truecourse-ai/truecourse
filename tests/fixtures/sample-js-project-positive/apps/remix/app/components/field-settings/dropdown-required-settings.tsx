
// --- react-useless-set-state FP: setRequired(required) in dropdown uses locally derived var ---
declare function useState<T>(init: T): [T, (v: T) => void];

type DropdownFieldMeta = { required?: boolean; values?: string[] };

function DropdownRequiredSettings({ initialMeta }: { initialMeta: DropdownFieldMeta }) {
  const [required, setRequired] = useState(initialMeta.required ?? false);
  const [values, setValues] = useState(initialMeta.values ?? []);

  const handleToggleChange = (field: keyof DropdownFieldMeta, value: string | boolean) => {
    const required = field === 'required' ? Boolean(value) : Boolean(initialMeta.required);
    setRequired(required);
  };

  return <button onClick={() => handleToggleChange('required', !required)}>{required ? 'Optional' : 'Required'}</button>;
}
