
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


// onValueChange receives string, handleInput accepts string — JSX callback forwarding, no argument type mismatch
declare function SelectField(props: {
  value?: string;
  onValueChange?: (value: string) => void;
  children: unknown;
}): JSX.Element;
declare function SelectFieldContent(props: { children: unknown }): JSX.Element;
declare function SelectFieldItem(props: { value: string; children: unknown }): JSX.Element;
declare function updateFieldMetaSetting(key: string, value: string): void;

function TextAlignmentSelector({ currentAlign }: { currentAlign?: string }) {
  return (
    <SelectField
      value={currentAlign}
      onValueChange={(value) => updateFieldMetaSetting('textAlign', value)}
    >
      <SelectFieldContent>
        <SelectFieldItem value="left">Left</SelectFieldItem>
        <SelectFieldItem value="center">Center</SelectFieldItem>
        <SelectFieldItem value="right">Right</SelectFieldItem>
        <SelectFieldItem value="justify">Justify</SelectFieldItem>
      </SelectFieldContent>
    </SelectField>
  );
}

