/**
 * Unit tests for `_shared/framework-detection.ts`.
 *
 * Like the other shared helpers, these are tested in isolation BEFORE any
 * visitor uses them.
 */
import { describe, it, expect } from 'vitest'
import { parseCode } from '../../packages/analyzer/src/parser'
import {
  detectWebFramework,
  detectUiFramework,
  detectValidator,
  isAuthMiddlewareName,
  isRateLimitMiddlewareName,
  importsRateLimiter,
  isValidationCallName,
  isFrameworkComponentBase,
} from '../../packages/analyzer/src/rules/_shared/framework-detection'
import type { SyntaxNode } from 'tree-sitter'

function root(code: string, lang: 'typescript' | 'tsx' | 'javascript' = 'typescript'): SyntaxNode {
  return parseCode(code, lang).rootNode
}

// ---------------------------------------------------------------------------
// detectWebFramework
// ---------------------------------------------------------------------------

describe('detectWebFramework', () => {
  it('detects express from default import', () => {
    expect(detectWebFramework(root(`import express from 'express';`))).toBe('express')
  })

  it('detects express from named import', () => {
    expect(detectWebFramework(root(`import { Router } from 'express';`))).toBe('express')
  })

  it('detects express from sub-path import', () => {
    expect(detectWebFramework(root(`import { Router } from 'express/router';`))).toBe('express')
  })

  it('detects fastify', () => {
    expect(detectWebFramework(root(`import Fastify from 'fastify';`))).toBe('fastify')
  })

  it('detects @fastify/* sub-package', () => {
    expect(detectWebFramework(root(`import cors from '@fastify/cors';`))).toBe('fastify')
  })

  it('detects koa', () => {
    expect(detectWebFramework(root(`import Koa from 'koa';`))).toBe('koa')
  })

  it('detects @koa/router', () => {
    expect(detectWebFramework(root(`import Router from '@koa/router';`))).toBe('koa')
  })

  it('detects hono', () => {
    expect(detectWebFramework(root(`import { Hono } from 'hono';`))).toBe('hono')
  })

  it('detects hono sub-path', () => {
    expect(detectWebFramework(root(`import { logger } from 'hono/logger';`))).toBe('hono')
  })

  it('detects next', () => {
    expect(detectWebFramework(root(`import { NextResponse } from 'next/server';`))).toBe('next')
  })

  it('detects via require()', () => {
    expect(detectWebFramework(root(`const express = require('express');`, 'javascript'))).toBe('express')
  })

  it('returns unknown when no framework imported', () => {
    expect(detectWebFramework(root(`const x = 1;`))).toBe('unknown')
  })

  it('returns unknown for unrelated imports', () => {
    expect(detectWebFramework(root(`import lodash from 'lodash';`))).toBe('unknown')
  })

  it('does NOT match a substring like "expression"', () => {
    expect(detectWebFramework(root(`import { expression } from 'expression';`))).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// detectUiFramework
// ---------------------------------------------------------------------------

describe('detectUiFramework', () => {
  it('detects react', () => {
    expect(detectUiFramework(root(`import React from 'react';`))).toBe('react')
  })

  it('detects react/jsx-runtime', () => {
    expect(detectUiFramework(root(`import { jsx } from 'react/jsx-runtime';`))).toBe('react')
  })

  it('detects react-dom as react', () => {
    expect(detectUiFramework(root(`import { createRoot } from 'react-dom/client';`))).toBe('react')
  })

  it('detects preact as react (compat)', () => {
    expect(detectUiFramework(root(`import { h } from 'preact';`))).toBe('react')
  })

  it('detects vue', () => {
    expect(detectUiFramework(root(`import { ref } from 'vue';`))).toBe('vue')
  })

  it('detects @vue/* sub-package', () => {
    expect(detectUiFramework(root(`import { createApp } from '@vue/runtime-dom';`))).toBe('vue')
  })

  it('detects svelte', () => {
    expect(detectUiFramework(root(`import { onMount } from 'svelte';`))).toBe('svelte')
  })

  it('detects solid-js', () => {
    expect(detectUiFramework(root(`import { createSignal } from 'solid-js';`))).toBe('solid')
  })

  it('returns unknown for non-UI imports', () => {
    expect(detectUiFramework(root(`import express from 'express';`))).toBe('unknown')
  })

  it('does NOT match react-router as react', () => {
    // react-router is React-specific but not React itself; the dependency check
    // is intentionally narrow — react-router doesn't make a file a React file by itself.
    expect(detectUiFramework(root(`import { Routes } from 'react-router-dom';`))).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// detectValidator
// ---------------------------------------------------------------------------

describe('detectValidator', () => {
  it('detects zod', () => {
    expect(detectValidator(root(`import { z } from 'zod';`))).toBe('zod')
  })

  it('detects joi', () => {
    expect(detectValidator(root(`import Joi from 'joi';`))).toBe('joi')
  })

  it('detects @hapi/joi as joi', () => {
    expect(detectValidator(root(`import Joi from '@hapi/joi';`))).toBe('joi')
  })

  it('detects yup', () => {
    expect(detectValidator(root(`import * as yup from 'yup';`))).toBe('yup')
  })

  it('detects io-ts', () => {
    expect(detectValidator(root(`import * as t from 'io-ts';`))).toBe('io-ts')
  })

  it('detects superstruct', () => {
    expect(detectValidator(root(`import { object, string } from 'superstruct';`))).toBe('superstruct')
  })

  it('detects valibot', () => {
    expect(detectValidator(root(`import * as v from 'valibot';`))).toBe('valibot')
  })

  it('detects runtypes', () => {
    expect(detectValidator(root(`import { String, Record } from 'runtypes';`))).toBe('runtypes')
  })

  it('detects class-validator', () => {
    expect(detectValidator(root(`import { IsEmail } from 'class-validator';`))).toBe('class-validator')
  })

  it('detects @effect/schema', () => {
    expect(detectValidator(root(`import { Schema } from '@effect/schema';`))).toBe('effect-schema')
  })

  it('returns unknown when no validator imported', () => {
    expect(detectValidator(root(`import express from 'express';`))).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// isAuthMiddlewareName
// ---------------------------------------------------------------------------

describe('isAuthMiddlewareName', () => {
  it.each([
    'authenticate',
    'authMiddleware',
    'authRequired',
    'authorize',
    'requireAuth',
    'requireUser',
    'requireLogin',
    'requireSession',
    'isAuthenticated',
    'ensureLoggedIn',
    'verifyJwt',
    'verifyToken',
    'verifyAuth',
    'verifyUser',
    'verifySession',
    'verifyBearer',
    'jwtAuth',
    'jwtVerify',
    'jwtMiddleware',
    'bearerToken',
    'sessionAuth',
    'passport',
    'clerkMiddleware',
    'withAuth',
    'withMiddlewareAuthRequired',
    'getServerSession',
    'protect',
  ])('matches %s', (name) => {
    expect(isAuthMiddlewareName(name)).toBe(true)
  })

  it.each([
    'logger',
    'cors',
    'bodyParser',
    'rateLimit',
    'compress',
    'helmet',
    'morgan',
    'errorHandler',
    'validateBody',
    '',
  ])('does NOT match %s', (name) => {
    expect(isAuthMiddlewareName(name)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isRateLimitMiddlewareName
// ---------------------------------------------------------------------------

describe('isRateLimitMiddlewareName', () => {
  it.each(['rateLimit', 'rateLimiter', 'rateLimitMiddleware', 'RateLimiter', 'throttle', 'slowDown', 'requestThrottle'])(
    'matches %s',
    (name) => {
      expect(isRateLimitMiddlewareName(name)).toBe(true)
    }
  )

  it.each(['authenticate', 'logger', 'helmet', ''])('does NOT match %s', (name) => {
    expect(isRateLimitMiddlewareName(name)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// importsRateLimiter
// ---------------------------------------------------------------------------

describe('importsRateLimiter', () => {
  it('detects express-rate-limit', () => {
    expect(importsRateLimiter(root(`import rateLimit from 'express-rate-limit';`))).toBe(true)
  })

  it('detects @fastify/rate-limit', () => {
    expect(importsRateLimiter(root(`import rateLimit from '@fastify/rate-limit';`))).toBe(true)
  })

  it('detects koa-ratelimit', () => {
    expect(importsRateLimiter(root(`import ratelimit from 'koa-ratelimit';`))).toBe(true)
  })

  it('detects rate-limiter-flexible', () => {
    expect(importsRateLimiter(root(`import { RateLimiterMemory } from 'rate-limiter-flexible';`))).toBe(true)
  })

  it('detects @upstash/ratelimit', () => {
    expect(importsRateLimiter(root(`import { Ratelimit } from '@upstash/ratelimit';`))).toBe(true)
  })

  it('returns false when no rate limiter imported', () => {
    expect(importsRateLimiter(root(`import express from 'express';`))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isValidationCallName
// ---------------------------------------------------------------------------

describe('isValidationCallName', () => {
  it('matches parse for zod', () => {
    expect(isValidationCallName('parse', 'zod')).toBe(true)
  })

  it('matches safeParse for zod', () => {
    expect(isValidationCallName('safeParse', 'zod')).toBe(true)
  })

  it('matches validate for joi', () => {
    expect(isValidationCallName('validate', 'joi')).toBe(true)
  })

  it('matches validateSync for yup', () => {
    expect(isValidationCallName('validateSync', 'yup')).toBe(true)
  })

  it('returns false for unknown validator', () => {
    expect(isValidationCallName('parse', 'unknown')).toBe(false)
  })

  it('returns false for unrelated method names', () => {
    expect(isValidationCallName('toString', 'zod')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isFrameworkComponentBase
// ---------------------------------------------------------------------------

describe('isFrameworkComponentBase', () => {
  it.each(['React.Component', 'Component', 'React.PureComponent', 'PureComponent', 'Vue', 'HTMLElement'])(
    'matches %s',
    (cls) => {
      expect(isFrameworkComponentBase(cls)).toBe(true)
    }
  )

  it.each(['BaseClass', 'EventEmitter', 'Error', '', null, undefined])('does NOT match %s', (cls) => {
    expect(isFrameworkComponentBase(cls as any)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Caching behavior
// ---------------------------------------------------------------------------

describe('import source caching', () => {
  it('reuses the same set across multiple calls on the same AST', () => {
    const node = root(`import express from 'express';`)
    expect(detectWebFramework(node)).toBe('express')
    expect(detectUiFramework(node)).toBe('unknown')
    expect(detectValidator(node)).toBe('unknown')
    // No assertion needed beyond "doesn't crash" — but the WeakMap should
    // mean the second/third call is O(1).
  })

  it('treats different ASTs independently', () => {
    expect(detectWebFramework(root(`import x from 'express';`))).toBe('express')
    expect(detectWebFramework(root(`import x from 'fastify';`))).toBe('fastify')
  })
})
