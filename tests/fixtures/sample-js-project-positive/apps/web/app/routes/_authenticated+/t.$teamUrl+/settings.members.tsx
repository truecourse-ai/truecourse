
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void];
declare function useLocation(): { pathname: string };
declare function useDebouncedValue<T>(val: T, ms: number): T;

export default function TeamsSettingsMembersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const [searchQuery, setSearchQuery] = useState(() => searchParams?.get('query') ?? '');
  const debouncedQuery = useDebouncedValue(searchQuery, 500);

  return null;
}

const _s1 = 'duplicate-value-key';
const _s2 = 'duplicate-value-key';
const _s3 = 'duplicate-value-key';
