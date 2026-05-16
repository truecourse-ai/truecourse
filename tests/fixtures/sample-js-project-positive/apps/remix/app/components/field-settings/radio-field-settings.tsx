
// --- react-useless-set-state FP: setRequired(required) uses locally derived var ---
declare function useState<T>(init: T): [T, (v: T) => void];

type RadioMeta = { readOnly?: boolean; required?: boolean };

function RadioFieldSettings({ initialMeta }: { initialMeta: RadioMeta }) {
  const [readOnly, setReadOnly] = useState(initialMeta.readOnly ?? false);
  const [required, setRequired] = useState(initialMeta.required ?? false);

  const handleToggleChange = (field: keyof RadioMeta, value: string | boolean) => {
    const readOnly = field === 'readOnly' ? Boolean(value) : Boolean(initialMeta.readOnly);
    const required = field === 'required' ? Boolean(value) : Boolean(initialMeta.required);
    setReadOnly(readOnly);
    setRequired(required);
  };

  return <div onClick={() => handleToggleChange('required', true)}>{required ? 'required' : 'optional'}</div>;
}
