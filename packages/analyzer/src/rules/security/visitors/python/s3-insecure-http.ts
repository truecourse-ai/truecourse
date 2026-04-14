import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonS3InsecureHttpVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/s3-insecure-http',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (methodName !== 'client' && methodName !== 'resource') return null
    if (objectName !== 'boto3' && objectName !== '') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'use_ssl' && value?.text === 'False') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'S3 client without SSL',
            'boto3 client created with use_ssl=False. Data in transit will not be encrypted.',
            sourceCode,
            'Remove use_ssl=False to ensure encrypted communication with S3.',
          )
        }
        if (name?.text === 'endpoint_url' && value) {
          const url = value.text.replace(/['"]/g, '')
          if (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'S3 client without SSL',
              `boto3 client endpoint "${url}" uses HTTP instead of HTTPS.`,
              sourceCode,
              'Use an HTTPS endpoint URL for boto3 S3 clients.',
            )
          }
        }
      }
    }

    return null
  },
}
