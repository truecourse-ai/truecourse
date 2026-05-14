
// --- react-useless-set-state FP: setState called with locally computed var derived from param ---
declare function useState<T>(init: T): [T, (v: T) => void];

type DropdownMeta = { readOnly?: boolean; required?: boolean; values?: string[] };

function DropdownFieldSettings({ initialMeta }: { initialMeta: DropdownMeta }) {
  const [readOnly, setReadOnly] = useState(initialMeta.readOnly ?? false);
  const [required, setRequired] = useState(initialMeta.required ?? false);
  const [values, setValues] = useState(initialMeta.values ?? []);

  const handleToggleChange = (field: keyof DropdownMeta, value: string | boolean) => {
    const readOnly = field === 'readOnly' ? Boolean(value) : Boolean(initialMeta.readOnly);
    const required = field === 'required' ? Boolean(value) : Boolean(initialMeta.required);
    setReadOnly(readOnly);
    setRequired(required);
  };

  return <div>{readOnly ? 'readonly' : 'editable'} {required ? 'required' : ''}</div>;
}
