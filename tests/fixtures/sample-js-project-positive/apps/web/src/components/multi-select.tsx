
// --- argument-type-mismatch shape: stdlib-and-third-party-api-calls (.find used as boolean inside .some) ---
interface SelectOption { value: string; label: string; }
type GroupedOptions = Record<string, SelectOption[]>;

function isOptionsPresent(groupedOptions: GroupedOptions, targetOptions: SelectOption[]): boolean {
  for (const [, values] of Object.entries(groupedOptions)) {
    if (values.some((option) => targetOptions.find((p) => p.value === option.value))) {
      return true;
    }
  }
  return false;
}

function filterSelectedOptions(groupedOptions: GroupedOptions, selected: SelectOption[]): GroupedOptions {
  const cloned = JSON.parse(JSON.stringify(groupedOptions)) as GroupedOptions;
  for (const [key, values] of Object.entries(cloned)) {
    cloned[key] = values.filter((val) => !selected.find((p) => p.value === val.value));
  }
  return cloned;
}

export { isOptionsPresent, filterSelectedOptions };
