
// FP: React component with hooks and JSX — standard React framework structure
declare const useIsMounted: () => boolean;
declare const useLocation: () => { pathname: string };
declare const useNavigate: () => (path: string) => void;
declare const useSearchParams: () => [URLSearchParams, (p: URLSearchParams) => void];
declare const MultiSelectCombobox: React.FC<{ options: Array<{ label: string; value: string }>; value: string[]; onChange: (vals: string[]) => void; placeholder?: string; className?: string }>;

type DocumentsTableStatusFilterProps = {
  teamId: number;
};

export const DocumentsTableStatusFilter = ({ teamId }: DocumentsTableStatusFilterProps) => {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const isMounted = useIsMounted();

  const selectedStatuses = (searchParams?.get('statuses') ?? '')
    .split(',')
    .filter((v) => v !== '');

  const statusOptions = React.useMemo(
    () => [
      { label: 'Draft', value: 'DRAFT' },
      { label: 'Pending', value: 'PENDING' },
      { label: 'Completed', value: 'COMPLETED' },
      { label: 'Declined', value: 'DECLINED' },
    ],
    [],
  );

  const handleChange = (values: string[]) => {
    const next = new URLSearchParams(searchParams.toString());

    if (values.length === 0) {
      next.delete('statuses');
    } else {
      next.set('statuses', values.join(','));
    }

    next.delete('page');
    navigate(`${pathname}?${next.toString()}`);
  };

  if (!isMounted) {
    return null;
  }

  return (
    <MultiSelectCombobox
      options={statusOptions}
      value={selectedStatuses}
      onChange={handleChange}
      placeholder="Filter by status"
      className="w-52"
    />
  );
};
