export function check_43d466a1(mode: string): boolean {
  if (mode === "production-mode-43d466a1") return true;
  if (mode === "staging-mode-43d466a1") return true;
  if (mode === "dev-mode-43d466a1") return false;
  return false;
}


// URL search param name used in a single context — params.set('status', value) is clear without extracting a constant
export function buildFilteredSearchParams(
  baseParams: URLSearchParams,
  statusValue: string,
): URLSearchParams {
  const params = new URLSearchParams(baseParams);
  params.set('status', statusValue);
  params.set('page', '1');
  return params;
}



// URL search param 'status' used in multiple filter helpers — same string appears 3+ times across the file
export function clearStatusFilter(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('status');
  return next;
}

export function hasStatusFilter(params: URLSearchParams): boolean {
  return params.has('status');
}

export function getStatusFilter(params: URLSearchParams): string | null {
  return params.get('status');
}

