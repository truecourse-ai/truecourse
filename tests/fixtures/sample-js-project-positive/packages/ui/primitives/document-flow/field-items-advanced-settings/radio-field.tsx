// Single radio field settings calls handleFieldChange with 'values' — one usage in distinct component
declare function handleFieldChange(key: string, value: unknown): void;

interface RadioOption {
  label: string;
  value: string;
}

function onRadioOptionsChange(options: RadioOption[]) {
  handleFieldChange('values', options.map((o) => o.value).join('|'));
}
