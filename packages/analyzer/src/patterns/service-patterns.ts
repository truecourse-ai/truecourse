/**
 * Service detection patterns for TypeScript/JavaScript projects
 * Converted from SpecMind's service-detection.json, keeping only TS/JS relevant patterns
 */

export const monorepoPatterns = [
  'packages',
  'services',
  'apps',
  'microservices',
  'shared',
  'libs',
  'modules',
]

export const metaFrameworks = [
  'next',
  'nuxt',
  '@nestjs/core',
  '@angular/core',
  '@sveltejs/kit',
]

export const entryPointPatterns = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'server.ts',
  'server.js',
  'main.ts',
  'main.tsx',
  // Python
  'main.py',
  'app.py',
  'manage.py',
  'wsgi.py',
  'asgi.py',
]

export const commonSourceDirectories = [
  'src',
  'lib',
  'app',
]

export const frontendFrameworks = [
  'react',
  'react-dom',
  'next',
  'nuxt',
  '@angular/core',
  'angular',
  'vue',
  '@vue/core',
  'svelte',
  '@sveltejs/kit',
  'solid-js',
  'preact',
  'qwik',
  '@builder.io/qwik',
]

export const frontendBuildTools = [
  'vite',
  'webpack',
  'parcel',
  'rollup',
  'esbuild',
  '@vitejs/plugin-react',
  'create-react-app',
  'create-next-app',
]

export const frontendFileIndicators = [
  '**/pages/**',
  '**/app/**',
  '**/components/**',
  '**/views/**',
  '**/*component*.{ts,tsx,js,jsx}',
  '**/*page*.{ts,tsx,js,jsx}',
  '**/public/**',
  '**/static/**',
]

export const apiFrameworks = [
  'express',
  '@nestjs/common',
  '@nestjs/core',
  'fastify',
  '@fastify/cors',
  'koa',
  '@koa/router',
  'hapi',
  '@hapi/hapi',
  'restify',
  'polka',
  'micro',
  '@trpc/server',
  'elysia',
  'hono',
  // Python
  'flask',
  'fastapi',
  'django',
  'django-rest-framework',
  'djangorestframework',
  'starlette',
  'sanic',
  'falcon',
  'pyramid',
]

export const apiServerFileIndicators = [
  'routes',
  'routers',
  'controllers',
  'api',
  'endpoints',
  'server.ts',
  'server.js',
]

export const workerFrameworks = [
  'bull',
  'bullmq',
  'bee-queue',
  'kue',
  'agenda',
  'bree',
  // Python
  'celery',
  'dramatiq',
  'rq',
  'huey',
]

export const workerFileIndicators = [
  'worker',
  'workers',
  'jobs',
  'tasks',
  'queue',
  'queues',
  'background',
]

export const libraryPackageJsonIndicators = [
  'main',
  'module',
  'exports',
  'types',
  'typings',
]

/**
 * Aggregated service detection configuration
 */
export const serviceDetectionPatterns = {
  monorepoPatterns,
  metaFrameworks,
  entryPoints: entryPointPatterns,
  commonSourceDirectories,
  frontend: {
    frameworks: frontendFrameworks,
    buildTools: frontendBuildTools,
    fileIndicators: frontendFileIndicators,
  },
  apiServer: {
    frameworks: apiFrameworks,
    fileIndicators: apiServerFileIndicators,
  },
  worker: {
    frameworks: workerFrameworks,
    fileIndicators: workerFileIndicators,
  },
  library: {
    packageJsonIndicators: libraryPackageJsonIndicators,
  },
}
