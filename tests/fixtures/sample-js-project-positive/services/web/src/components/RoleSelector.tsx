// shared UI library subpath import — @sample/ui is a public monorepo UI package
// importing from its /lib/utils subpath is not a cross-service internal access
declare function mergeClasses(...inputs: (string | undefined | null | false)[]): string;
declare const React: {
  useState: <T>(initial: T) => [T, (v: T) => void];
  useEffect: (fn: () => void, deps: unknown[]) => void;
};

type RoleSelectorProps = {
  availableRoles: string[];
  selectedRoles: string[];
  onSelectionChange: (roles: string[]) => void;
};

const RoleSelector = ({ availableRoles, selectedRoles, onSelectionChange }: RoleSelectorProps) => {
  const [open, setOpen] = React.useState(false);
  const [localSelected, setLocalSelected] = React.useState<string[]>(selectedRoles);

  React.useEffect(() => {
    setLocalSelected(selectedRoles);
  }, [selectedRoles]);

  const allOptions = [...new Set([...availableRoles, ...localSelected])];

  const handleToggle = (role: string) => {
    const next = localSelected.includes(role)
      ? localSelected.filter((r) => r !== role)
      : [...localSelected, role];
    setLocalSelected(next);
    onSelectionChange(next);
    setOpen(false);
  };

  const triggerLabel = localSelected.length > 0 ? localSelected.join(', ') : 'Select roles';

  return (
    <div className={mergeClasses('relative inline-block', open && 'z-50')}>
      <button
        type="button"
        className={mergeClasses('flex items-center gap-2 rounded border px-3 py-1.5 text-sm')}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{triggerLabel}</span>
      </button>
      {open && (
        <ul className={mergeClasses('absolute mt-1 w-48 rounded border bg-white shadow-md')}>
          {allOptions.map((role) => (
            <li
              key={role}
              className={mergeClasses(
                'cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-100',
                localSelected.includes(role) && 'font-semibold text-blue-600',
              )}
              onClick={() => handleToggle(role)}
            >
              {role}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
