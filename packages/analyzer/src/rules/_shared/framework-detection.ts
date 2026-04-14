/**
 * Framework / library detection helpers for visitors.
 *
 * Several rules need to know which web framework, UI framework, ORM, or
 * validation library a file uses so they can apply the right detection
 * heuristic. Without this, rules either:
 *   - hardcode one framework (e.g. Express only) and silently produce no
 *     coverage on other frameworks, OR
 *   - use file-level keyword grep (e.g. `text.includes('passport')`) which
 *     is fragile and exempts unrelated routes.
 *
 * The functions here detect the framework via the file's `import_statement`
 * sources — the most reliable signal — and cache the result per AST root.
 */
import type { SyntaxNode } from 'tree-sitter'

export type WebFramework = 'express' | 'fastify' | 'koa' | 'hono' | 'next' | 'unknown'
export type UiFramework = 'react' | 'vue' | 'svelte' | 'solid' | 'unknown'
export type Validator =
  | 'zod'
  | 'joi'
  | 'yup'
  | 'io-ts'
  | 'superstruct'
  | 'valibot'
  | 'runtypes'
  | 'class-validator'
  | 'effect-schema'
  | 'unknown'
export type Orm =
  | 'drizzle'
  | 'prisma'
  | 'sequelize'
  | 'typeorm'
  | 'mongoose'
  | 'objection'
  | 'lucid'
  | 'unknown'

// ---------------------------------------------------------------------------
// Import source extraction (cached per program root)
// ---------------------------------------------------------------------------

const importSourceCache = new WeakMap<SyntaxNode, Set<string>>()

/** Walk to the AST root (program node). */
function getProgramNode(node: SyntaxNode): SyntaxNode {
  let current: SyntaxNode = node
  while (current.parent) current = current.parent
  return current
}

/**
 * Extract all import sources (the module specifiers) from a file's AST.
 * Cached per program root so repeated calls in the same file are O(1).
 *
 * Handles:
 *   - `import x from 'foo'` (ES module imports)
 *   - `import 'foo'` (side-effect imports)
 *   - `require('foo')` (CommonJS)
 *   - `await import('foo')` (dynamic imports)
 */
function getImportSources(node: SyntaxNode): Set<string> {
  const program = getProgramNode(node)
  const cached = importSourceCache.get(program)
  if (cached) return cached

  const sources = new Set<string>()

  function walk(n: SyntaxNode): void {
    // ES module: `import x from 'foo'` or `import 'foo'`
    if (n.type === 'import_statement') {
      const sourceNode = n.childForFieldName('source')
      if (sourceNode?.type === 'string') {
        const text = sourceNode.text.replace(/^['"`]|['"`]$/g, '')
        if (text) sources.add(text)
      }
    }

    // CommonJS: `require('foo')` and dynamic `import('foo')`
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      if (fn?.type === 'identifier' && (fn.text === 'require' || fn.text === 'import')) {
        const args = n.childForFieldName('arguments')
        const firstArg = args?.namedChildren[0]
        if (firstArg?.type === 'string') {
          const text = firstArg.text.replace(/^['"`]|['"`]$/g, '')
          if (text) sources.add(text)
        }
      }
    }

    for (const child of n.namedChildren) walk(child)
  }
  walk(program)

  importSourceCache.set(program, sources)
  return sources
}

/** Reset the cache. Used by tests; visitors should not call this. */
export function _resetImportSourceCache(): void {
  // WeakMap has no clear() — reassigning the const is impossible. Tests can
  // construct a fresh AST instead, which gets a fresh WeakMap entry.
}

// ---------------------------------------------------------------------------
// Web framework detection
// ---------------------------------------------------------------------------

/**
 * Detect the web framework used by a file based on its imports.
 *
 * Returns 'unknown' if no recognized framework is imported. Visitors that
 * use this should treat 'unknown' as "skip — we can't analyze this safely"
 * rather than defaulting to one framework.
 */
export function detectWebFramework(node: SyntaxNode): WebFramework {
  const sources = getImportSources(node)
  for (const src of sources) {
    if (src === 'express' || src.startsWith('express/')) return 'express'
    if (src === 'fastify' || src.startsWith('fastify/') || src.startsWith('@fastify/')) return 'fastify'
    if (src === 'koa' || src.startsWith('koa/') || src.startsWith('@koa/')) return 'koa'
    if (src === 'hono' || src.startsWith('hono/')) return 'hono'
    if (src === 'next' || src.startsWith('next/')) return 'next'
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// UI framework detection
// ---------------------------------------------------------------------------

/**
 * Detect the UI framework used by a file based on its imports.
 */
export function detectUiFramework(node: SyntaxNode): UiFramework {
  const sources = getImportSources(node)
  for (const src of sources) {
    if (src === 'react' || src.startsWith('react/') || src === 'react-dom' || src.startsWith('react-dom/')) return 'react'
    if (src === 'preact' || src.startsWith('preact/')) return 'react' // preact is React-compatible
    if (src === 'vue' || src.startsWith('vue/') || src.startsWith('@vue/')) return 'vue'
    if (src === 'svelte' || src.startsWith('svelte/')) return 'svelte'
    if (src === 'solid-js' || src.startsWith('solid-js/')) return 'solid'
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Validator library detection
// ---------------------------------------------------------------------------

/**
 * Detect the validation library used by a file based on its imports.
 */
export function detectValidator(node: SyntaxNode): Validator {
  const sources = getImportSources(node)
  for (const src of sources) {
    if (src === 'zod' || src.startsWith('zod/')) return 'zod'
    if (src === 'joi' || src === '@hapi/joi') return 'joi'
    if (src === 'yup' || src.startsWith('yup/')) return 'yup'
    if (src === 'io-ts' || src.startsWith('io-ts/')) return 'io-ts'
    if (src === 'superstruct') return 'superstruct'
    if (src === 'valibot' || src.startsWith('valibot/')) return 'valibot'
    if (src === 'runtypes') return 'runtypes'
    if (src === 'class-validator') return 'class-validator'
    if (src === 'effect' || src.startsWith('effect/') || src === '@effect/schema') return 'effect-schema'
  }
  return 'unknown'
}

/**
 * Detect the ORM (Object-Relational Mapper) used by a file based on its imports.
 *
 * Returns 'unknown' if no recognized ORM is imported. Visitors that detect
 * ORM-specific patterns (lazy loading, N+1 queries, etc.) should treat
 * 'unknown' as "skip — this file doesn't use a supported ORM".
 */
export function detectOrm(node: SyntaxNode): Orm {
  const sources = getImportSources(node)
  for (const src of sources) {
    if (src === 'drizzle-orm' || src.startsWith('drizzle-orm/')) return 'drizzle'
    if (src === '@prisma/client' || src === 'prisma') return 'prisma'
    if (src === 'sequelize' || src === 'sequelize-typescript') return 'sequelize'
    if (src === 'typeorm') return 'typeorm'
    if (src === 'mongoose') return 'mongoose'
    if (src === 'objection') return 'objection'
    if (src === '@adonisjs/lucid' || src.startsWith('@adonisjs/lucid/')) return 'lucid'
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Per-framework helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `name` looks like an authentication middleware/function.
 *
 * Covers common naming conventions across frameworks and packages:
 *   - generic: authenticate, authMiddleware, requireAuth, isAuthenticated,
 *     ensureLoggedIn, requireUser, sessionAuth
 *   - JWT-style: verifyJwt, verifyToken, bearerToken, jwtAuth
 *   - well-known packages: passport.X, clerkMiddleware, auth0, withAuth,
 *     getServerSession, withMiddlewareAuthRequired
 *
 * Intentionally case-insensitive on the prefix portion to catch
 * `AuthMiddleware`, `authmiddleware`, etc.
 */
export function isAuthMiddlewareName(name: string): boolean {
  if (!name) return false
  return /^(authenticate|auth(?:Middleware|Required|orize)|requireAuth|requireUser|requireLogin|requireSession|isAuthenticated|ensureLoggedIn|verify(?:Jwt|Token|Auth|User|Session|Bearer)|jwt(?:Auth|Verify|Middleware)|bearerToken|sessionAuth|passport|clerkMiddleware|withAuth|withMiddlewareAuthRequired|getServerSession|protect)/i.test(name)
}

/**
 * Returns true if `name` looks like a rate-limiting middleware.
 *
 * Covers express-rate-limit (`rateLimit`), @fastify/rate-limit, koa-ratelimit,
 * hono-rate-limiter, and common project-local naming conventions
 * (`rateLimiter`, `throttle`, `slowDown`).
 */
export function isRateLimitMiddlewareName(name: string): boolean {
  if (!name) return false
  return /^(rateLimit(?:er|Middleware)?|RateLimiter|throttle|slowDown|requestThrottle)/i.test(name)
}

/**
 * Returns true if a file imports a known rate-limiting library.
 */
export function importsRateLimiter(node: SyntaxNode): boolean {
  const sources = getImportSources(node)
  for (const src of sources) {
    if (
      src === 'express-rate-limit' ||
      src === 'express-slow-down' ||
      src === '@fastify/rate-limit' ||
      src === 'koa-ratelimit' ||
      src === '@koa/ratelimit' ||
      src === 'hono-rate-limiter' ||
      src === 'rate-limiter-flexible' ||
      src === 'limiter' ||
      src.startsWith('@upstash/ratelimit')
    ) {
      return true
    }
  }
  return false
}

/**
 * Returns true if `name` looks like a validation library entry point or
 * a common validator method call (e.g. `parse`, `validate`, `safeParse`).
 *
 * The validator argument scopes the check — for `'unknown'`, returns false.
 */
export function isValidationCallName(name: string, validator: Validator): boolean {
  if (validator === 'unknown') return false
  // Method names common across most validation libraries
  return /^(parse|safeParse|parseAsync|validate|validateSync|validateAsync|check|assert|is|decode|create)$/.test(name)
}

/**
 * Returns true if a class extends a known UI-framework component base
 * (React.Component, Vue's Component, etc.) so methods that override the
 * base shouldn't be flagged as static-method candidates.
 *
 * `superClass` is the text of the extends clause (e.g. "React.Component",
 * "Component", "Vue").
 */
export function isFrameworkComponentBase(superClass: string | null | undefined): boolean {
  if (!superClass) return false
  return /^(React\.)?Component$|^React\.PureComponent$|^PureComponent$|^Vue(\..+)?$|^HTMLElement$/.test(superClass)
}
