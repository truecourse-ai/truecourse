
// OpenAPI tag string literal in procedure metadata — API documentation constant
declare const authenticatedProcedure: { meta: (m: object) => any };

const findFoldersProcedure = authenticatedProcedure
  .meta({
    openapi: {
      method: 'GET',
      path: '/folder',
      summary: 'Find folders',
      tags: ['Folder'],
    },
  });
