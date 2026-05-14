// URL inside an OpenAPI spec description string — documentation text embedded in the spec.
const apiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'MyApp API',
    version: '1.0.0',
    description: 'Full API reference. Interactive playground available at https://api.example.com/docs.',
  },
  paths: {},
};


// Object.assign(generateOpenApi(...), {...}) — Object.assign accepts any target and sources, no type mismatch
declare function generateOpenApi(contract: object, info: object, opts: object): object;
declare const ApiContractV2: object;

export const OpenAPIV2 = Object.assign(
  generateOpenApi(
    ApiContractV2,
    {
      info: {
        title: 'Example API v2',
        version: '2.0.0',
        description: 'V2 API. See https://docs.example.com/developers/api for the full reference.',
      },
    },
    { setOperationId: true, jsonQuery: true },
  ),
  {
    'x-tagGroups': [
      { name: 'Envelopes', tags: ['Envelopes', 'Recipients', 'Fields'] },
      { name: 'Templates', tags: ['Templates'] },
    ],
  },
);



// argument-type-mismatch: passes object where boolean expected — genuine TS2345
function setOperationId(contract: object, enabled: boolean): object {
  return enabled ? contract : {};
}
// TS2345: Argument of type '{ setOperationId: boolean }' is not assignable to parameter of type 'boolean'
const _openApiOpts = setOperationId({}, { setOperationId: true });

