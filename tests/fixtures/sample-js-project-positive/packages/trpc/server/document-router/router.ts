// Two OpenAPI route definitions each specify their own tag array — per-router tag namespacing
declare function openApiRoute(config: { tags: string[]; method: string; path: string }): unknown;

const listDocumentsRoute = openApiRoute({
  tags: ['Documents'],
  method: 'GET',
  path: '/documents',
});

const createDocumentRoute = openApiRoute({
  tags: ['Documents'],
  method: 'POST',
  path: '/documents',
});
