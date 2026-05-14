// Single dropdown field settings calls handleFieldChange with key 'values' — one usage
declare function handleFieldChange(key: string, value: unknown): void;

interface DropdownOption {
  label: string;
  value: string;
}

function onDropdownOptionsChange(options: DropdownOption[]) {
  handleFieldChange('values', options.map((o) => o.value).join(','));
}
