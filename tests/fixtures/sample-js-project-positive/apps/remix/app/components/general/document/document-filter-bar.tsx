declare function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void];

export function handleSearchTermChange(term: string, searchParams: URLSearchParams, setSearchParams: (p: URLSearchParams) => void): void {
  const params = new URLSearchParams(searchParams.toString());

  if (term) {
    params.set('query', term);
  } else {
    params.delete('query');
  }

  setSearchParams(params);
}
