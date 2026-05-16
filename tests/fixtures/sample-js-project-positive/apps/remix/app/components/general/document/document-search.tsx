
// 'query' is the URL search parameter name for a search input — single-use framework API pattern.
declare function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void];

export function useSearchInput(initialValue = '') {
  const [searchParams, setSearchParams] = useSearchParams();

  const handleSearch = (term: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (term) {
      params.set('query', term);
    } else {
      params.delete('query');
    }
    setSearchParams(params);
  };

  return { handleSearch, currentQuery: searchParams.get('query') ?? initialValue };
}



// URL param names and default column names are single-use context-specific strings in an admin loader.
declare function getOrganisationStats(opts: {
  sortBy: string;
  sortOrder: string;
  page: number;
}): Promise<{ items: unknown[]; total: number }>;

export async function adminStatsLoader({ request }: { request: Request }) {
  const url = new URL(request.url);

  const rawSortBy = url.searchParams.get('sortBy') || 'signingVolume';
  const rawSortOrder = url.searchParams.get('sortOrder') || 'desc';
  const page = Number(url.searchParams.get('page')) || 1;

  return getOrganisationStats({ sortBy: rawSortBy, sortOrder: rawSortOrder, page });
}



// 'period' is a URL param name and 'all' is the default period value — single-use framework pattern.
declare function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void];
declare function useNavigate(): (path: string, opts?: { preventScrollReset?: boolean }) => void;
declare function useLocation(): { pathname: string };

export function usePeriodFilter() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const period = searchParams?.get('period') ?? 'all';

  const onPeriodChange = (newPeriod: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('period', newPeriod);
    if (newPeriod === '' || newPeriod === 'all') {
      params.delete('period');
    }
    navigate(`${pathname}?${params.toString()}`, { preventScrollReset: true });
  };

  return { period, onPeriodChange };
}



// URL route path prefix in navigation conditional — a single-use framework API string for active link detection.
declare function cn(...classes: (string | false | undefined)[]): string;
declare function useLocation(): { pathname?: string };

export function buildAdminNavItemClass(routePrefix: string): string {
  const { pathname } = useLocation();
  return cn(
    'justify-start md:w-full',
    pathname?.startsWith(routePrefix) && 'bg-secondary',
  );
}

export function AdminStatsNavItem() {
  const { pathname } = useLocation();
  return cn(
    'justify-start md:w-full',
    pathname?.startsWith('/admin/stats') && 'bg-secondary',
  );
}
