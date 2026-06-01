import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const SPECS: ChoiceSpec[] = [
  {
    value: 'rest',
    packages: ['express', 'fastify', 'koa', '@hapi/hapi', 'hapi', '@nestjs/core', 'fastapi', 'flask', 'django', 'djangorestframework', 'starlette', 'sanic', 'aiohttp', 'bottle', 'falcon'],
    imports: ['express', 'fastify', 'koa', 'fastapi', 'flask', 'django', 'starlette'],
  },
  {
    value: 'grpc',
    packages: ['@grpc/grpc-js', 'grpc', 'grpc-tools', 'nice-grpc', 'grpcio', 'grpcio-tools'],
    configGlobs: ['*.proto', '**/*.proto'],
  },
  {
    value: 'graphql',
    packages: ['apollo-server', '@apollo/server', 'graphql-yoga', '@nestjs/graphql', 'mercurius', 'strawberry-graphql', 'graphene', 'ariadne'],
    configGlobs: ['*.graphql', '*.gql', '**/*.graphql', '**/*.gql'],
  },
  { value: 'trpc', packages: ['@trpc/server', '@trpc/client'], imports: ['@trpc/server', '@trpc/client'] },
];

export const communicationPatternDetector: ArchitectureDetector = {
  category: 'communication-pattern',
  alternatives: [...SPECS.map((s) => s.value), 'message-queue-primary'],
  detect: (scan, scope) => detectByChoiceSpecs('communication-pattern', scan, SPECS, { scope }),
};
