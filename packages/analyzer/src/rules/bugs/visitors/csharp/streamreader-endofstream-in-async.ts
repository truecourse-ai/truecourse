import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideAsyncFunction } from './_helpers.js'

/**
 * `StreamReader.EndOfStream` read inside an async method. The property performs a
 * synchronous, blocking read of the underlying stream to decide whether more data
 * exists, defeating the surrounding async code and risking thread-pool starvation
 * under load. An async reader loop should drive on `ReadLineAsync`/`ReadAsync`
 * instead of polling `EndOfStream`. The member name is distinctive to StreamReader,
 * so matching it inside an async scope is false-positive free.
 */
export const csharpStreamReaderEndOfStreamInAsyncVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/streamreader-endofstream-in-async',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'EndOfStream') return null
    if (!isInsideAsyncFunction(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'EndOfStream read in an async method',
      'EndOfStream blocks synchronously inside an async method — drive the loop on ReadLineAsync/ReadAsync instead.',
      sourceCode,
      'Read with ReadLineAsync/ReadAsync and loop on a null/-1 result instead of polling EndOfStream.',
    )
  },
}
