
declare interface SelectOption { label: string; value: string; group?: string }
declare type GroupedOptions = Record<string, SelectOption[]>;

function groupOptionsByCategory(options: SelectOption[], groupBy: keyof SelectOption): GroupedOptions {
  if (!options || options.length === 0) {
    return { '': [] };
  }

  const groupOption: GroupedOptions = {};
  options.forEach((option) => {
    const key = (option[groupBy] as string) || '';
    if (!groupOption[key]) {
      groupOption[key] = [];
    }
    groupOption[key].push(option);
  });

  return groupOption;
}



// --- FP shape: internal utility function returning boolean; return type trivially inferred, not a public export ---
declare interface SelectOption { value: string; label: string }
declare interface SelectGroup { [key: string]: SelectOption[] }

function isOptionsExist(groupOption: SelectGroup, targetOption: SelectOption[]) {
  for (const [, value] of Object.entries(groupOption)) {
    if (value.some((option) => targetOption.find((p) => p.value === option.value))) {
      return true;
    }
  }
  return false;
}



// --- FP shape: internal utility function returning GroupOption; return type inferred from deep-clone and filter, not a public export ---
declare interface SelectOption2 { value: string; label: string }
declare interface GroupOption2 { [key: string]: SelectOption2[] }

function removePickedOption(groupOption: GroupOption2, picked: SelectOption2[]) {
  const cloneOption = JSON.parse(JSON.stringify(groupOption)) as GroupOption2;

  for (const [key, value] of Object.entries(cloneOption)) {
    cloneOption[key] = value.filter((val) => !picked.find((p) => p.value === val.value));
  }
  return cloneOption;
}
