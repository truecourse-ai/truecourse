// TeamGroupsCombobox — selects multiple team groups via the shared UI multi-select
// MultiSelect and Option come from the monorepo's shared UI library package;
// this is NOT a cross-service import — @sample/ui is a public shared package.
import { MultiSelect, type Option } from '@sample/ui/primitives/multiselect';

export type TeamGroupOption = {
  /** Team group ID. */
  id: string;
  name: string;
};

type TeamGroupsComboboxProps = {
  teamId: string;
  selectedGroups: TeamGroupOption[];
  onChange: (groups: TeamGroupOption[]) => void;
  excludeProjectId?: number;
  perPage?: number;
  className?: string;
  dataTestId?: string;
};

declare function useTeamGroupSearch(
  teamId: string,
  query: string,
  perPage: number
): { data: TeamGroupOption[]; isLoading: boolean };

const toOption = (group: TeamGroupOption): Option => ({
  value: group.id,
  label: group.name,
});

export function TeamGroupsCombobox({
  teamId,
  selectedGroups,
  onChange,
  excludeProjectId,
  perPage = 100,
  className,
  dataTestId,
}: TeamGroupsComboboxProps): JSX.Element {
  const { data: groups = [], isLoading } = useTeamGroupSearch(teamId, '', perPage);

  const options: Option[] = groups.map(toOption);
  const value: Option[] = selectedGroups.map(toOption);

  const handleChange = (selected: Option[]) => {
    onChange(
      selected.map((opt) => ({
        id: opt.value,
        name: opt.label,
      }))
    );
  };

  return (
    <MultiSelect
      options={options}
      value={value}
      onChange={handleChange}
      isLoading={isLoading}
      className={className}
      data-testid={dataTestId}
    />
  );
}
