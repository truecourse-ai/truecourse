/**
 * Unit tests for `_shared/javascript-helpers.ts`.
 *
 * These helpers are intentionally tested in isolation BEFORE any visitor uses
 * them — see docs/BATTLE-TEST-CYCLE.md (the fileAnalyses bug from April 2026
 * would have been caught by this kind of in-isolation helper test).
 */
import { describe, it, expect } from 'vitest'
import { parseCode } from '../../packages/analyzer/src/parser'
import { buildDataFlowContext } from '../../packages/analyzer/src/data-flow/use-def-chains'
import {
  containsJsx,
  containsIdentifierExact,
  findUserInputAccess,
} from '../../packages/analyzer/src/rules/_shared/javascript-helpers'
import type { SyntaxNode } from 'tree-sitter'

function rootNode(code: string, language: 'typescript' | 'tsx' | 'javascript' = 'typescript'): SyntaxNode {
  return parseCode(code, language).rootNode
}

function parseWithDataFlow(code: string, language: 'typescript' | 'javascript' = 'typescript') {
  const tree = parseCode(code, language)
  const dataFlow = buildDataFlowContext(tree.rootNode, language)
  return { root: tree.rootNode, dataFlow }
}

/** Find the first descendant matching the given type. */
function firstNodeOfType(root: SyntaxNode, type: string): SyntaxNode | null {
  if (root.type === type) return root
  for (const child of root.namedChildren) {
    const found = firstNodeOfType(child, type)
    if (found) return found
  }
  return null
}

/** Find the first call_expression whose callee text equals `calleeText`. */
function findCallByCallee(root: SyntaxNode, calleeText: string): SyntaxNode | null {
  function walk(n: SyntaxNode): SyntaxNode | null {
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      if (fn?.text === calleeText) return n
    }
    for (const child of n.namedChildren) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(root)
}

// ---------------------------------------------------------------------------
// containsJsx
// ---------------------------------------------------------------------------

describe('containsJsx', () => {
  it('returns true for a self-closing JSX element', () => {
    const root = rootNode(`const x = <Foo />;`, 'tsx')
    expect(containsJsx(root)).toBe(true)
  })

  it('returns true for a JSX element with children', () => {
    const root = rootNode(`const x = <div><span>hi</span></div>;`, 'tsx')
    expect(containsJsx(root)).toBe(true)
  })

  it('returns true for a JSX fragment', () => {
    const root = rootNode(`const x = <><Foo /><Bar /></>;`, 'tsx')
    expect(containsJsx(root)).toBe(true)
  })

  it('returns true when JSX is nested inside a function body', () => {
    const code = `
      function App() {
        return <div>hello</div>;
      }
    `
    expect(containsJsx(rootNode(code, 'tsx'))).toBe(true)
  })

  it('returns true when JSX is inside a conditional expression', () => {
    const code = `
      function App({ visible }: { visible: boolean }) {
        return visible ? <div>shown</div> : null;
      }
    `
    expect(containsJsx(rootNode(code, 'tsx'))).toBe(true)
  })

  // ---- The cases that broke text.includes('<') ----

  it('returns false for TypeScript generics like Array<T>', () => {
    const code = `function first<T>(arr: Array<T>): T { return arr[0]; }`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for nested generics like Map<K, V>', () => {
    const code = `function makeMap<K, V>(): Map<K, V> { return new Map<K, V>(); }`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for comparison operators', () => {
    const code = `function compare(a: number, b: number): number { return a > b ? 1 : a < b ? -1 : 0; }`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for combined generics and comparisons', () => {
    const code = `
      function clamp<T extends number>(val: T, min: T, max: T): T {
        return val < min ? min : val > max ? max : val;
      }
    `
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for angle brackets inside string literals', () => {
    const code = `const html = "<div>not jsx</div>";`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for arrow function syntax (=>)', () => {
    const code = `const fn = (x: number) => x + 1;`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for an empty file', () => {
    expect(containsJsx(rootNode(``))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// containsIdentifierExact
// ---------------------------------------------------------------------------

describe('containsIdentifierExact', () => {
  it('returns true when the identifier appears as a bare reference', () => {
    const root = rootNode(`const x = foo;`)
    expect(containsIdentifierExact(root, 'foo')).toBe(true)
  })

  it('returns true when the identifier appears as a call callee', () => {
    const root = rootNode(`bar();`)
    expect(containsIdentifierExact(root, 'bar')).toBe(true)
  })

  it('returns true when the identifier appears as a member expression object', () => {
    const root = rootNode(`obj.prop = 1;`)
    expect(containsIdentifierExact(root, 'obj')).toBe(true)
  })

  it('returns true for identifiers nested deep in expressions', () => {
    const root = rootNode(`const x = a + (b * (c - foo));`)
    expect(containsIdentifierExact(root, 'foo')).toBe(true)
  })

  // ---- The cases that broke text.includes(name) ----

  it('returns false for substring collisions (id vs getId)', () => {
    const root = rootNode(`function getId() { return 1; }`)
    expect(containsIdentifierExact(root, 'id')).toBe(false)
  })

  it('returns false for substring collisions (body vs bodyParser)', () => {
    const root = rootNode(`const bodyParser = require('body-parser');`)
    expect(containsIdentifierExact(root, 'body')).toBe(false)
  })

  it('returns false for substring collisions (req vs request)', () => {
    const root = rootNode(`const request = makeRequest();`)
    expect(containsIdentifierExact(root, 'req')).toBe(false)
  })

  it('returns false when the name only appears inside a string literal', () => {
    const root = rootNode(`const msg = "foo bar";`)
    expect(containsIdentifierExact(root, 'foo')).toBe(false)
  })

  it('returns false when the name only appears inside a comment', () => {
    const root = rootNode(`// uses foo somewhere\nconst x = 1;`)
    expect(containsIdentifierExact(root, 'foo')).toBe(false)
  })

  it('returns false for member access property (only object is an identifier)', () => {
    // For `a.b`, `b` is a property_identifier, not an identifier — by design.
    const root = rootNode(`const x = a.b;`)
    expect(containsIdentifierExact(root, 'a')).toBe(true)
    expect(containsIdentifierExact(root, 'b')).toBe(false)
  })

  it('returns false for an empty file', () => {
    expect(containsIdentifierExact(rootNode(``), 'anything')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// findUserInputAccess
// ---------------------------------------------------------------------------

describe('findUserInputAccess', () => {
  // ---- Pattern 1: direct member access (no dataFlow needed) ----

  it('detects req.body', () => {
    const root = rootNode(`db.insert(users).values(req.body);`)
    const found = findUserInputAccess(root)
    expect(found).not.toBeNull()
    expect(found?.kind).toBe('direct-member')
    expect(found?.accessor).toBe('req.body')
  })

  it('detects request.params', () => {
    const root = rootNode(`return request.params;`)
    expect(findUserInputAccess(root)?.accessor).toBe('request.params')
  })

  it('detects ctx.request.body (Koa)', () => {
    const root = rootNode(`db.insert(users).values(ctx.request.body);`)
    const found = findUserInputAccess(root)
    expect(found?.accessor).toBe('ctx.request.body')
  })

  it('detects event.body (AWS Lambda)', () => {
    const root = rootNode(`return JSON.parse(event.body);`)
    const found = findUserInputAccess(root)
    expect(found?.accessor).toBe('event.body')
  })

  it('detects req.body inside a chained call', () => {
    const root = rootNode(`db.insert(users).values(req.body.user).execute();`)
    const found = findUserInputAccess(root)
    expect(found).not.toBeNull()
    expect(found?.accessor).toBe('req.body')
  })

  // ---- The substring-leak FPs the previous code produced ----

  it('does NOT match identifiers named bodyParser', () => {
    const root = rootNode(`const bodyParser = require('body-parser'); app.use(bodyParser.json());`)
    expect(findUserInputAccess(root)).toBeNull()
  })

  it('does NOT match identifiers named everyBody', () => {
    const root = rootNode(`const everyBody = "x"; logger.log(everyBody);`)
    expect(findUserInputAccess(root)).toBeNull()
  })

  it('does NOT match identifiers named subQuery', () => {
    const root = rootNode(`const subQuery = sql.select(); pool.execute(subQuery);`)
    expect(findUserInputAccess(root)).toBeNull()
  })

  it('does NOT match identifiers named queryBuilder', () => {
    const root = rootNode(`const queryBuilder = makeBuilder(); queryBuilder.run();`)
    expect(findUserInputAccess(root)).toBeNull()
  })

  it('does NOT match a string literal containing "req.body"', () => {
    const root = rootNode(`logger.log("send req.body to api");`)
    expect(findUserInputAccess(root)).toBeNull()
  })

  // ---- Pattern 2: parameters resolved via dataFlow ----

  it('detects req parameter in handler signature', () => {
    const code = `
      async function handler(req, res) {
        await db.insert(users).values(req);
      }
    `
    const { root, dataFlow } = parseWithDataFlow(code, 'javascript')
    const insertCall = findCallByCallee(root, 'db.insert(users).values')!
    const arg = insertCall.childForFieldName('arguments')!.namedChildren[0]
    const found = findUserInputAccess(arg, dataFlow)
    expect(found?.kind).toBe('parameter')
    expect(found?.accessor).toBe('req')
  })

  it('does NOT flag a parameter named userId', () => {
    const code = `
      function getById(userId) {
        return db.users.findById(userId);
      }
    `
    const { root, dataFlow } = parseWithDataFlow(code, 'javascript')
    const findById = findCallByCallee(root, 'db.users.findById')!
    const arg = findById.childForFieldName('arguments')!.namedChildren[0]
    expect(findUserInputAccess(arg, dataFlow)).toBeNull()
  })

  // ---- Pattern 3: aliased identifiers ----

  it('detects const body = req.body alias', () => {
    const code = `
      function handler(req, res) {
        const body = req.body;
        db.insert(users).values(body);
      }
    `
    const { root, dataFlow } = parseWithDataFlow(code, 'javascript')
    const insertCall = findCallByCallee(root, 'db.insert(users).values')!
    const arg = insertCall.childForFieldName('arguments')!.namedChildren[0]
    const found = findUserInputAccess(arg, dataFlow)
    expect(found?.kind).toBe('aliased-identifier')
    expect(found?.accessor).toBe('body')
  })

  it('detects destructured const { body } = req alias', () => {
    const code = `
      function handler(req, res) {
        const { body } = req;
        db.insert(users).values(body);
      }
    `
    const { root, dataFlow } = parseWithDataFlow(code, 'javascript')
    const insertCall = findCallByCallee(root, 'db.insert(users).values')!
    const arg = insertCall.childForFieldName('arguments')!.namedChildren[0]
    const found = findUserInputAccess(arg, dataFlow)
    expect(found?.kind).toBe('aliased-identifier')
    expect(found?.accessor).toBe('body')
  })

  // ---- The "local data variable" FP we just fixed ----

  it('does NOT flag a local var named data initialized from cache.get', () => {
    const code = `
      async function syncUser(userId) {
        const data = await cache.get(userId);
        await db.insert(users).values(data);
      }
    `
    const { root, dataFlow } = parseWithDataFlow(code, 'javascript')
    const insertCall = findCallByCallee(root, 'db.insert(users).values')!
    const arg = insertCall.childForFieldName('arguments')!.namedChildren[0]
    expect(findUserInputAccess(arg, dataFlow)).toBeNull()
  })

  it('does NOT flag a local var named payload initialized from a constant', () => {
    const code = `
      function send() {
        const payload = { type: "ping" };
        return socket.emit(payload);
      }
    `
    const { root, dataFlow } = parseWithDataFlow(code, 'javascript')
    const emit = findCallByCallee(root, 'socket.emit')!
    const arg = emit.childForFieldName('arguments')!.namedChildren[0]
    expect(findUserInputAccess(arg, dataFlow)).toBeNull()
  })

  // ---- Without dataFlow ----

  it('still detects direct member access without dataFlow', () => {
    const root = rootNode(`db.insert(users).values(req.body);`)
    const insertCall = findCallByCallee(root, 'db.insert(users).values')!
    const arg = insertCall.childForFieldName('arguments')!.namedChildren[0]
    expect(findUserInputAccess(arg)?.kind).toBe('direct-member')
  })

  it('does NOT detect aliased identifiers without dataFlow', () => {
    const code = `
      function handler(req) {
        const body = req.body;
        db.insert(users).values(body);
      }
    `
    const root = rootNode(code, 'javascript')
    const insertCall = findCallByCallee(root, 'db.insert(users).values')!
    const arg = insertCall.childForFieldName('arguments')!.namedChildren[0]
    // Without dataFlow we can't resolve the alias
    expect(findUserInputAccess(arg)).toBeNull()
  })
})
