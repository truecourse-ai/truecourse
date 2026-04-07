/**
 * Security violations related to GraphQL, XML, and archive handling.
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

// VIOLATION: security/deterministic/graphql-dos-vulnerability
export function graphqlDosVulnerability() {
  const buildSchema = (schema: string) => schema;
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

// VIOLATION: security/deterministic/graphql-introspection-enabled
export function graphqlIntrospectionEnabled() {
  return new ApolloServer({
    typeDefs: 'type Query { hello: String }',
    resolvers: {},
    introspection: true,
  });
}

// VIOLATION: security/deterministic/unsafe-xml-signature
export function unsafeXmlSignature() {
  return new SignedXml();
}

// VIOLATION: security/deterministic/xml-xxe
export function xmlXxeDomParser() {
  return new DOMParser();
}

// VIOLATION: security/deterministic/xml-xxe
export function xmlXxeParseString(xml: string) {
  const parseString = (input: string) => input;
  return parseString(xml);
}

// VIOLATION: security/deterministic/unsafe-unzip
export function unsafeUnzip() {
  const archive = { extractAllTo: (dest: string) => {} };
  archive.extractAllTo('/tmp/extracted');
}

// VIOLATION: security/deterministic/wildcard-in-os-command
export function wildcardInOsCommand() {
  const { execSync } = require('child_process');
  execSync('rm -rf /tmp/*.log');
}

// VIOLATION: security/deterministic/process-signaling
export function processSignaling(pid: any) {
  process.kill(pid, 'SIGTERM');
}
