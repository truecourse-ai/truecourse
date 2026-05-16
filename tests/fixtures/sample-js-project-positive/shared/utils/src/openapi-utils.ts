
// Snippet: Object.assign with function call result and additional properties object
declare function buildBaseSpec(contract: object, info: object, opts: object): object;
declare const apiContract: object;

export const ApiSpec = Object.assign(
  buildBaseSpec(
    apiContract,
    { title: 'Internal API', version: '2.0.0' },
    { setOperationId: true },
  ),
  {
    'x-tagGroups': [{ name: 'Core', tags: ['documents', 'recipients'] }],
  },
);
