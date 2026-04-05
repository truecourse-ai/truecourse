import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const graphqlIntrospectionEnabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/graphql-introspection-enabled',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression', 'object'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'object') {
      // Look for { introspection: true } in graphql server config objects
      for (const prop of node.namedChildren) {
        if (prop.type === 'pair') {
          const key = prop.childForFieldName('key')
          const value = prop.childForFieldName('value')
          if (key?.text?.replace(/['"]/g, '') === 'introspection' && value?.text === 'true') {
            // Check that the parent context is a GraphQL server call
            let parent = node.parent
            let depth = 0
            while (parent && depth < 5) {
              const pText = parent.text
              if (/ApolloServer|GraphQLServer|graphqlHTTP|createServer/.test(pText)) {
                return makeViolation(
                  this.ruleKey, node, filePath, 'medium',
                  'GraphQL introspection enabled',
                  'GraphQL introspection is explicitly enabled. This exposes your full API schema to attackers.',
                  sourceCode,
                  'Disable introspection in production: set introspection: process.env.NODE_ENV !== "production".',
                )
              }
              parent = parent.parent
              depth++
            }
          }
        }
      }
    }

    return null
  },
}
