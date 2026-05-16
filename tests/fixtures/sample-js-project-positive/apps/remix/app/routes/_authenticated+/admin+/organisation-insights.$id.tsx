declare const url: URL;

function getInsightsQueryParams() {
  const page = Number(url.searchParams.get('page')) || 1;
  const perPage = Number(url.searchParams.get('perPage')) || 10;
  return { page, perPage };
}
