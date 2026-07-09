import { describe, it, expect } from 'vitest'
import { tmpdir } from 'os'
import { LspClient } from '../../packages/analyzer/src/lsp-client'

// Regression for the EPIPE defect class (issue #658, generalized): a language
// server that dies must surface as a rejected promise, never as an unhandled
// 'error' event on the child's stdin that crashes the whole process — and never
// as a request that hangs forever (LSP requests have no per-call timeout).
//
// We stand in a real, dependency-free "server" with `node`: it accepts the
// request bytes on stdin but exits without ever replying to `initialize`. Before
// the fix this either crashed the worker (write to a closed pipe) or hung; after
// it, the process 'exit' / stdin 'error' handlers reject the in-flight request,
// so `start()` rejects cleanly and this test simply completes.
describe('LspClient — resilient when the server dies', () => {
  it('rejects start() instead of crashing when the server exits without responding', async () => {
    const client = new LspClient({
      name: 'FakeServer',
      command: process.execPath, // node — always present
      // Stay alive briefly to absorb the initialize write, then exit without
      // ever sending an LSP response.
      args: ['-e', 'process.stdin.resume(); setTimeout(() => process.exit(1), 50)'],
    })

    await expect(client.start(tmpdir())).rejects.toThrow(/FakeServer/)
  })
})
