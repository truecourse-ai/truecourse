
// FP: JSON.parse(JSON.stringify(groupOption)) as GroupOption — deep-clone preserves the shape.
// The structure is structurally identical after round-trip; assertion is correct.
type SelectOption = { value: string; label: string };
type GroupOption = Record<string, SelectOption[]>;

function filterSelectedOptions(groupOption: GroupOption, picked: SelectOption[]): GroupOption {
  const cloneOption = JSON.parse(JSON.stringify(groupOption)) as GroupOption;

  for (const [key, value] of Object.entries(cloneOption)) {
    cloneOption[key] = value.filter((val) => !picked.find((p) => p.value === val.value));
  }

  return cloneOption;
}



// FP: JSON.parse(JSON.stringify(options)) as OptionGroup — structurally guaranteed round-trip clone.
type FilterOption = { id: string; name: string; active: boolean };
type OptionGroup = Record<string, FilterOption[]>;

function deepCloneOptionGroup(opts: OptionGroup): OptionGroup {
  return JSON.parse(JSON.stringify(opts)) as OptionGroup;
}

function removeSelected(group: OptionGroup, selectedIds: string[]): OptionGroup {
  const cloned = deepCloneOptionGroup(group);
  for (const key of Object.keys(cloned)) {
    cloned[key] = cloned[key]!.filter((opt) => !selectedIds.includes(opt.id));
  }
  return cloned;
}
