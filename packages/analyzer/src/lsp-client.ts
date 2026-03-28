/**
 * Generic LSP (Language Server Protocol) client for semantic analysis.
 *
 * Spawns a language server as a child process, communicates via JSON-RPC
 * over stdin/stdout, and provides module resolution, export detection,
 * and class hierarchy analysis — the same capabilities as our TS compiler
 * integration (ts-compiler.ts) but via the universal LSP protocol.
 *
 * This client is language-agnostic. Each language provides a server config
 * (see lsp-servers/) that specifies the binary, args, and init options.
 *
 * Used for all non-JS/TS languages: Python (Pyright), C# (OmniSharp),
 * Go (gopls), Java (Eclipse JDT), Rust (rust-analyzer).
 */

import { ChildProcess, spawn } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL, fileURLToPath } from 'url'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LspServerConfig {
  /** Display name (e.g., "Pyright") */
  name: string
  /** Command to spawn the server */
  command: string
  /** Arguments to pass to the command */
  args: string[]
  /** Additional initialization options sent in initialize request */
  initializationOptions?: Record<string, unknown>
}

export interface LspAnalysisResult {
  /** Map of file path → set of exported symbol names */
  exportMap: Map<string, Set<string>>
  /** Map of method name → set of implementing class names */
  interfaceImplementations: Map<string, Set<string>>
}

interface LspMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: any
  result?: any
  error?: { code: number; message: string; data?: any }
}

// ---------------------------------------------------------------------------
// JSON-RPC framing
// ---------------------------------------------------------------------------

function encodeMessage(msg: LspMessage): Buffer {
  const body = JSON.stringify(msg)
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
  return Buffer.from(header + body)
}

// ---------------------------------------------------------------------------
// LSP Client
// ---------------------------------------------------------------------------

export class LspClient {
  private config: LspServerConfig
  private process: ChildProcess | null = null
  private requestId = 0
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>()
  private buffer = Buffer.alloc(0)
  private rootPath = ''

  constructor(config: LspServerConfig) {
    this.config = config
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(rootPath: string): Promise<void> {
    this.rootPath = resolve(rootPath)

    this.process = spawn(this.config.command, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.rootPath,
    })

    this.process.stdout!.on('data', (chunk: Buffer) => this.onData(chunk))
    this.process.stderr!.on('data', (chunk: Buffer) => {
      // Pyright logs to stderr — ignore unless debugging
    })

    this.process.on('error', (err) => {
      for (const pending of this.pendingRequests.values()) {
        pending.reject(err)
      }
      this.pendingRequests.clear()
    })

    // Initialize
    const initResult = await this.sendRequest('initialize', {
      processId: process.pid,
      capabilities: {
        textDocument: {
          definition: { dynamicRegistration: false },
          documentSymbol: {
            dynamicRegistration: false,
            hierarchicalDocumentSymbolSupport: true,
          },
          hover: { dynamicRegistration: false, contentFormat: ['plaintext'] },
        },
      },
      rootUri: pathToFileURL(this.rootPath).href,
      workspaceFolders: [
        { uri: pathToFileURL(this.rootPath).href, name: 'root' },
      ],
      initializationOptions: this.config.initializationOptions,
    })

    // Send initialized notification
    this.sendNotification('initialized', {})

    return initResult
  }

  async stop(): Promise<void> {
    if (!this.process) return

    try {
      await this.sendRequest('shutdown', null)
      this.sendNotification('exit', null)
    } catch {
      // Server may have already exited
    }

    // Give it a moment to exit gracefully, then force kill
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill('SIGKILL')
        resolve()
      }, 2000)

      this.process!.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    this.process = null
    this.pendingRequests.clear()
  }

  // -------------------------------------------------------------------------
  // Document management
  // -------------------------------------------------------------------------

  openFile(filePath: string): void {
    const absPath = resolve(this.rootPath, filePath)
    const content = readFileSync(absPath, 'utf-8')
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: pathToFileURL(absPath).href,
        languageId: 'python',
        version: 1,
        text: content,
      },
    })
  }

  // -------------------------------------------------------------------------
  // Semantic analysis — mirrors ts-compiler.ts interface
  // -------------------------------------------------------------------------

  /**
   * Resolve an import specifier to an absolute file path.
   * Uses textDocument/definition on the import source location.
   */
  async resolveImport(
    filePath: string,
    line: number,
    character: number,
  ): Promise<string | null> {
    const absPath = resolve(this.rootPath, filePath)
    const result = await this.sendRequest('textDocument/definition', {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: { line, character },
    })

    if (!result) return null

    // Result can be a Location, Location[], or LocationLink[]
    const locations = Array.isArray(result) ? result : [result]
    if (locations.length === 0) return null

    const uri = locations[0].uri || locations[0].targetUri
    if (!uri) return null

    try {
      return fileURLToPath(uri)
    } catch {
      return null
    }
  }

  /**
   * Get all symbols exported by a file.
   * Uses textDocument/documentSymbol to get the symbol tree.
   */
  async getFileExports(filePath: string): Promise<Set<string>> {
    const absPath = resolve(this.rootPath, filePath)
    const result = await this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(absPath).href },
    })

    const exports = new Set<string>()
    if (!result || !Array.isArray(result)) return exports

    for (const symbol of result) {
      const name: string = symbol.name
      // Skip private symbols (Python convention: leading underscore)
      if (name.startsWith('_') && !name.startsWith('__')) continue
      // Skip dunder methods except __all__
      if (name.startsWith('__') && name.endsWith('__') && name !== '__all__') continue

      // Include top-level functions, classes, and variables
      // SymbolKind: Function=12, Class=5, Variable=13, Constant=14, Module=2
      const kind: number = symbol.kind
      if ([2, 5, 12, 13, 14].includes(kind)) {
        exports.add(name)
      }
    }

    return exports
  }

  /**
   * Analyze semantics for a batch of files — mirrors analyzeSemantics() from ts-compiler.ts.
   *
   * Opens all files, waits for the server to analyze them, then queries
   * document symbols and type hierarchy for each file.
   */
  async analyzeSemantics(filePaths: string[]): Promise<LspAnalysisResult> {
    const exportMap = new Map<string, Set<string>>()
    const interfaceImplementations = new Map<string, Set<string>>()

    // Open all files to trigger analysis
    for (const fp of filePaths) {
      this.openFile(fp)
    }

    // Give the server time to analyze
    // Pyright processes files after didOpen notifications
    await this.waitForDiagnostics(filePaths.length)

    // Query exports for each file
    for (const fp of filePaths) {
      const exports = await this.getFileExports(fp)
      const absPath = resolve(this.rootPath, fp)
      exportMap.set(absPath, exports)
    }

    // Query class hierarchy for interface/protocol implementations
    // For each file, find classes and check if they implement protocols/ABCs
    for (const fp of filePaths) {
      const absPath = resolve(this.rootPath, fp)
      const symbols = await this.sendRequest('textDocument/documentSymbol', {
        textDocument: { uri: pathToFileURL(absPath).href },
      })

      if (!symbols || !Array.isArray(symbols)) continue

      for (const symbol of symbols) {
        // SymbolKind.Class = 5
        if (symbol.kind !== 5) continue

        // Check children (methods) of classes
        const children = symbol.children || []
        for (const child of children) {
          // SymbolKind.Method = 6
          if (child.kind === 6) {
            const methodName = child.name
            if (!interfaceImplementations.has(methodName)) {
              interfaceImplementations.set(methodName, new Set())
            }
            interfaceImplementations.get(methodName)!.add(symbol.name)
          }
        }
      }
    }

    return { exportMap, interfaceImplementations }
  }

  /**
   * Resolve all imports in the given files.
   * Returns a map: absolute file path → Map<import source, resolved absolute path>.
   */
  async resolveAllImports(
    fileAnalyses: Array<{ filePath: string; imports: Array<{ source: string; specifiers: Array<{ name: string }> }> }>,
  ): Promise<Map<string, Map<string, string>>> {
    const moduleMap = new Map<string, Map<string, string>>()

    for (const fa of fileAnalyses) {
      const absPath = resolve(this.rootPath, fa.filePath)
      const fileContent = readFileSync(absPath, 'utf-8')
      const lines = fileContent.split('\n')
      const fileResolutions = new Map<string, string>()

      for (const imp of fa.imports) {
        // Find the import source in the file content to get its line/column
        const location = findImportSourceLocation(lines, imp.source)
        if (!location) continue

        const resolved = await this.resolveImport(
          fa.filePath,
          location.line,
          location.character,
        )

        if (resolved) {
          fileResolutions.set(imp.source, resolved)
        }
      }

      moduleMap.set(absPath, fileResolutions)
    }

    return moduleMap
  }

  // -------------------------------------------------------------------------
  // Internal: JSON-RPC transport
  // -------------------------------------------------------------------------

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      this.pendingRequests.set(id, { resolve, reject })

      const msg: LspMessage = { jsonrpc: '2.0', id, method, params }
      this.process!.stdin!.write(encodeMessage(msg))
    })
  }

  private sendNotification(method: string, params: any): void {
    const msg: LspMessage = { jsonrpc: '2.0', method, params }
    this.process!.stdin!.write(encodeMessage(msg))
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    this.processBuffer()
  }

  private processBuffer(): void {
    while (true) {
      // Find the header/body separator
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return

      // Parse Content-Length
      const header = this.buffer.subarray(0, headerEnd).toString()
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        // Malformed header — skip past it
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(match[1], 10)
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + contentLength

      // Check if we have the full body
      if (this.buffer.length < bodyEnd) return

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString()
      this.buffer = this.buffer.subarray(bodyEnd)

      try {
        const msg: LspMessage = JSON.parse(body)
        this.handleMessage(msg)
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private handleMessage(msg: LspMessage): void {
    // Response to a request we sent
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!
      this.pendingRequests.delete(msg.id)

      if (msg.error) {
        pending.reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`))
      } else {
        pending.resolve(msg.result)
      }
      return
    }

    // Server-initiated notifications (diagnostics, log messages) — ignore
  }

  /**
   * Wait for the server to finish initial analysis by giving it time
   * to process opened files. Pyright sends diagnostics notifications
   * once analysis is complete.
   */
  private waitForDiagnostics(fileCount: number): Promise<void> {
    // Heuristic: wait based on file count, with min/max bounds.
    // Pyright is fast — typically <1s for small projects, ~3-5s for large ones.
    const waitMs = Math.min(Math.max(fileCount * 100, 1000), 10000)
    return new Promise((resolve) => setTimeout(resolve, waitMs))
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the line and character position of an import source string in file content.
 * Returns the position of the module name in the import statement.
 */
function findImportSourceLocation(
  lines: string[],
  importSource: string,
): { line: number; character: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match 'from <source> import ...' or 'import <source>'
    // Look for the source string in quotes or as a dotted name
    const patterns = [
      // from shared.utils.formatters import format_user
      new RegExp(`from\\s+(${escapeRegex(importSource)})\\s+import`),
      // import requests
      new RegExp(`^import\\s+(${escapeRegex(importSource)})\\s*$`),
      // import os\n (may have trailing content)
      new RegExp(`^import\\s+(${escapeRegex(importSource)})(?:\\s|,|$)`),
    ]

    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (match && match.index !== undefined) {
        // Position at the start of the module name
        const sourceStart = line.indexOf(importSource, match.index)
        if (sourceStart >= 0) {
          return { line: i, character: sourceStart }
        }
      }
    }
  }

  return null
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
