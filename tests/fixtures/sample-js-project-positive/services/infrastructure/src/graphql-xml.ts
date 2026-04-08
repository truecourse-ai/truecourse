/**
 * GraphQL, XML, and archive security patterns -- secure implementations.
 */

declare class ApolloServer {
  constructor(opts: Record<string, unknown>);
}

export function createGraphqlServer(): ApolloServer {
  return new ApolloServer({
    typeDefs: 'type Query { hello: String }',
    resolvers: {},
    introspection: false,
    validationRules: ['depthLimit(5)'],
  });
}

export function safeXmlSign(): Record<string, string> {
  return { algorithm: 'sha256', canonicalization: 'c14n11' };
}

export function safeXmlParse(xml: string): string {
  const safeParser = { parse: (input: string) => input.replace(/<!ENTITY/giu, '') };
  return safeParser.parse(xml);
}
