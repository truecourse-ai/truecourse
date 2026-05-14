// Each route independently reads 'query' URL search param — parallel standalone call sites
declare function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void];
declare function useState<T>(initial: T): [T, (v: T) => void];

function AdminReportsPage() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('query') ?? '');
  return { query };
}

function AdminUsersPage() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('query') ?? '');
  return { query };
}

function AdminAuditPage() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('query') ?? '');
  return { query };
}
