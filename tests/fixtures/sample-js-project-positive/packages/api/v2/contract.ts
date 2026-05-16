
declare const ZCreateWorkspaceMutationSchema: any;
declare const ZCreateWorkspaceMutationResponseSchema: any;
declare const ZUnsuccessfulResponseSchema: any;
declare const ZUpdateWorkspaceMutationSchema: any;
declare const ZUpdateWorkspaceMutationResponseSchema: any;

const apiV2Contract = {
  createWorkspace: {
    method: 'POST',
    path: '/api/v2/workspaces',
    body: ZCreateWorkspaceMutationSchema,
    responses: {
      200: ZCreateWorkspaceMutationResponseSchema,
      401: ZUnsuccessfulResponseSchema,
    },
    summary: 'Create a new workspace',
  },
  updateWorkspace: {
    method: 'POST',
    path: '/api/v2/workspaces/:id',
    body: ZUpdateWorkspaceMutationSchema,
    responses: {
      200: ZUpdateWorkspaceMutationResponseSchema,
      401: ZUnsuccessfulResponseSchema,
    },
    summary: 'Update an existing workspace',
  },
};
