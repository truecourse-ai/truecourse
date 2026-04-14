import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const DANGEROUS_PERMISSIONS = new Set(['geolocation', 'camera', 'microphone', 'notifications', 'push'])

export const intrusivePermissionsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/intrusive-permissions',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // navigator.permissions.query({ name: 'geolocation' })
    // navigator.geolocation.getCurrentPosition(...)
    // navigator.mediaDevices.getUserMedia(...)
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (!prop || !obj) return null

      if (prop.text === 'getUserMedia') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Intrusive permissions request',
          'getUserMedia() requests camera/microphone access. Ensure the user is informed before requesting.',
          sourceCode,
          'Request permissions only when necessary and explain the purpose to the user.',
        )
      }

      if (prop.text === 'getCurrentPosition' || prop.text === 'watchPosition') {
        const objText = obj.text
        if (objText.includes('geolocation') || objText.includes('navigator')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Intrusive permissions request',
            `${prop.text}() requests geolocation access. Ensure the user is informed before requesting.`,
            sourceCode,
            'Request permissions only when necessary and explain the purpose to the user.',
          )
        }
      }

      if (prop.text === 'query' && obj.type === 'member_expression') {
        const innerProp = obj.childForFieldName('property')
        if (innerProp?.text === 'permissions') {
          const args = node.childForFieldName('arguments')
          if (args) {
            for (const arg of args.namedChildren) {
              if (arg.type === 'object') {
                for (const pair of arg.namedChildren) {
                  if (pair.type === 'pair') {
                    const key = pair.childForFieldName('key')
                    const value = pair.childForFieldName('value')
                    if (key?.text === 'name' && value) {
                      const permName = value.text.replace(/['"]/g, '').toLowerCase()
                      if (DANGEROUS_PERMISSIONS.has(permName)) {
                        return makeViolation(
                          this.ruleKey, node, filePath, 'medium',
                          'Intrusive permissions request',
                          `Querying "${permName}" permission. Ensure the user is informed before requesting.`,
                          sourceCode,
                          'Request permissions only when necessary and explain the purpose to the user.',
                        )
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return null
  },
}
