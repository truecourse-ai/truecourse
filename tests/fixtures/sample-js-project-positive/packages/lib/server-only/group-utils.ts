
// --- function-return-type-varies shape: empty-object early-return vs populated GroupOption ---
// The early `return {}` is a structurally valid empty GroupOption, not a
// different type. TypeScript unifies all three branches as GroupOption.
declare type SelectOption = { value: string; label: string; [key: string]: unknown };
declare type GroupOption = { [key: string]: SelectOption[] };

function groupSelectOptions(options: SelectOption[], groupBy?: string): GroupOption {
  if (options.length === 0) {
    return {};
  }

  if (!groupBy) {
    return { '': options };
  }

  const grouped: GroupOption = {};

  for (const option of options) {
    const key = (option[groupBy] as string) ?? '';
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(option);
  }

  return grouped;
}
