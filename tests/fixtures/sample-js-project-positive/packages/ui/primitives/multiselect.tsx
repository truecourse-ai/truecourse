
interface SelectOption { label: string; value: string; }
interface GroupOption { label: string; options: SelectOption[]; }

function toGroupOption(label: string, options: SelectOption[]) {
  return { label, options };
}

function flattenGroups(groups: GroupOption[]) {
  return groups.flatMap((g) => g.options);
}
