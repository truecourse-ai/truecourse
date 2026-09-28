/**
 * The calls a file makes, as the analyzer names them: callee and argument text
 * read off the call itself, wherever it sits in the file.
 */

import { describe, expect, it } from 'vitest'
import { analyzeFileContent } from '../../packages/source-facts/src/file-analyzer'

describe('extractCalls — callee and argument text', () => {
  it('names calls correctly after leading whitespace and non-ASCII text', () => {
    const source = `\n  // Café — résumé ✓\n  const label = 'naïve'\n  app.all('/mcp', (c) => handleMcp(c.req.raw))\n`
    const calls = analyzeFileContent('src/app.ts', source, 'typescript').calls
    expect(calls.map((call) => [call.callee, call.arguments])).toEqual([
      ['app.all', ["'/mcp'", '(c) => handleMcp(c.req.raw)']],
      ['handleMcp', ['c.req.raw']],
    ])
  })
})


it('keeps JSX references at their original location after leading whitespace', () => {
  const source = '\n\n  function Page() {\n    return <Button onClick={handleClick} />\n  }'
  const calls = analyzeFileContent('src/page.tsx', source, 'tsx').calls
  expect(calls.find(call => call.callee === 'Button')).toMatchObject({
    callerFunction: 'Page', location: { startLine: 4, startColumn: 12 },
  })
  expect(calls.find(call => call.callee === 'handleClick')).toMatchObject({
    callerFunction: 'Page', location: { startLine: 4, startColumn: 28 },
  })
})
