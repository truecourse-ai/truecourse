import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCreatedTypeName, getInitializerAssignments, isStringNode, staticStringText } from './_helpers.js'

/**
 * .NET AWS SDK S3 client over plain HTTP: `new AmazonS3Config { UseHttp =
 * true }` or an http:// ServiceURL. Local dev endpoints
 * (localhost/127.0.0.1, e.g. MinIO/LocalStack) are excluded.
 */
export const csharpS3InsecureHttpVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/s3-insecure-http',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCreatedTypeName(node) !== 'AmazonS3Config') return null

    for (const prop of getInitializerAssignments(node)) {
      if (prop.name === 'UseHttp' && prop.value.text === 'true') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'S3 client without SSL',
          'AmazonS3Config with UseHttp = true sends S3 traffic unencrypted.',
          sourceCode,
          'Remove UseHttp = true so the client uses HTTPS.',
        )
      }
      if (prop.name === 'ServiceURL' && isStringNode(prop.value)) {
        const url = staticStringText(prop.value)
        if (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'S3 client without SSL',
            `S3 ServiceURL "${url}" uses HTTP instead of HTTPS.`,
            sourceCode,
            'Use an https:// endpoint for S3.',
          )
        }
      }
    }
    return null
  },
}
