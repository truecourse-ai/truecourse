/**
 * GraphQL, XML, and archive security patterns.
 */

declare class ApolloServer {
  constructor(opts: any);
}
declare class SignedXml {
  constructor();
}
declare class DOMParser {
  constructor();
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createGraphqlSchema() {
  const buildSchema = (schema: string) => schema;
  // VIOLATION: security/deterministic/graphql-dos-vulnerability
  return buildSchema(`
    type Query {
      users: [User]
    }
    type User {
      name: String
      friends: [User]
    }
  `);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createGraphqlServer() {
  // VIOLATION: security/deterministic/graphql-introspection-enabled
  return new ApolloServer({
    typeDefs: 'type Query { hello: String }',
    resolvers: {},
    introspection: true,
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function signXml() {
  // VIOLATION: security/deterministic/unsafe-xml-signature
  return new SignedXml();
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function parseXml() {
  // VIOLATION: security/deterministic/xml-xxe
  return new DOMParser();
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function parseXmlString(xml: string) {
  const parseString = (input: string) => input;
  // VIOLATION: security/deterministic/xml-xxe
  return parseString(xml);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function extractArchive() {
  const archive = { extractAllTo: (dest: string) => {} };
  // VIOLATION: security/deterministic/unsafe-unzip
  archive.extractAllTo('/tmp/extracted');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function killProcess(pid: any) {
  // VIOLATION: security/deterministic/process-signaling
  process.kill(pid, 'SIGTERM');
}
