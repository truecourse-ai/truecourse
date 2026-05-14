
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


// defaultValue?.map(...).filter(Boolean) with 'as Option[]' cast — intentional narrowing after filter, no type mismatch
type AuthOption = { value: string; label: string };

declare const authOptions: AuthOption[];
declare const currentValue: string[] | undefined;
declare const defaultValue: string[] | undefined;

const selectedOptions: AuthOption[] =
  (currentValue?.map((val) => authOptions.find((opt) => opt.value === val)).filter(Boolean) as AuthOption[]) || [];

const defaultOptions: AuthOption[] =
  (defaultValue?.map((val) => authOptions.find((opt) => opt.value === val)).filter(Boolean) as AuthOption[]) || [];



// .find used as truthy predicate inside .some — nested membership check, no type mismatch
interface TagOption { value: string; label: string; color?: string; }
type GroupedTagOptions = Record<string, TagOption[]>;

function hasMatchingTag(groupedTags: GroupedTagOptions, selectedTags: TagOption[]): boolean {
  for (const [, tags] of Object.entries(groupedTags)) {
    if (tags.some((tag) => selectedTags.find((s) => s.value === tag.value))) {
      return true;
    }
  }
  return false;
}

function removeSelectedTags(groupedTags: GroupedTagOptions, toRemove: TagOption[]): GroupedTagOptions {
  const result: GroupedTagOptions = {};
  for (const [group, tags] of Object.entries(groupedTags)) {
    result[group] = tags.filter((tag) => !toRemove.find((r) => r.value === tag.value));
  }
  return result;
}

