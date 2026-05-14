// import { NEXT_PUBLIC_WEBAPP_URL } from '@app/lib/constants/app';
// import { generateOpenApi } from '@ts-rest/open-api';

// import { ApiContractV1 } from './contract';

export const OpenAPIV1 = Object.assign(
  generateOpenApi(
    ApiContractV1,
    {
      info: {
        title: 'App API',
        version: '1.0.0',
        description:
          'API V1 is deprecated, but will continue to be supported. For more details, see https://docs.app.example.com/developers/public-api. \n\nThe App API for retrieving, creating, updating and deleting documents.',
      },
      servers: [
        {
          url: NEXT_PUBLIC_WEBAPP_URL(),
        },
      ],
    },
    {
      setOperationId: true,
    },
  ),
  {
    components: {
      securitySchemes: {
        authorization: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
        },
      },
    },
    security: [
      {
        authorization: [],
      },
    ],
  },
);
