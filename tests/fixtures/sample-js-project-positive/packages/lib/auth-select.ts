
type Option = { value: string; label: string };

enum PermissionLevel { READ = 'READ', WRITE = 'WRITE', ADMIN = 'ADMIN' }

declare const PERMISSION_DESCRIPTIONS: Record<PermissionLevel, { label: string }>;
declare function useTranslation(): { t: (msg: string) => string };

function buildPermissionOptions(): Option[] {
  const { t } = useTranslation();

  const noRestrictionOption: Option = { value: '-1', label: t('No restrictions') };

  const levelOptions: Option[] = Object.values(PermissionLevel).map((level) => ({
    value: level,
    label: t(PERMISSION_DESCRIPTIONS[level].label),
  }));

  return [noRestrictionOption, ...levelOptions];
}

function resolveSelectedOptions(values: string[] | undefined, allOptions: Option[]): Option[] {
  return (values?.map((val) => allOptions.find((opt) => opt.value === val)).filter(Boolean) as Option[]) || [];
}

function resolveDefaultOptions(defaults: string[] | undefined, allOptions: Option[]): Option[] {
  return (defaults?.map((val) => allOptions.find((opt) => opt.value === val)).filter(Boolean) as Option[]) || [];
}
