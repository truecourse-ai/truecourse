import { describe, expect, it } from 'vitest'
import { nearestNextRoot, nextRouterRoots } from '../../packages/shared/src/next-routing'

describe('shared Next router ownership', () => {
  it.each(['js', 'mjs', 'ts', 'mts'])('accepts next.config.%s as framework evidence', (extension) => {
    expect(nextRouterRoots({ files: [`/r/next.config.${extension}`, '/r/app/route.ts'] }, 'app')).toHaveLength(1)
  })

  it('supports config evidence at a relative repository root', () => {
    const roots = nextRouterRoots({ files: ['next.config.js', 'app/page.tsx'] }, 'app')
    expect(nearestNextRoot(roots, 'app/page.tsx')).toBe('app')
  })

  it('does not reinterpret a nested app ignored src directory as an ancestor route', () => {
    const files = [
      '/r/next.config.ts', '/r/app/page.tsx',
      '/r/app/example/next.config.mjs', '/r/app/example/app/page.tsx',
      '/r/app/example/src/app/ignored/page.tsx',
    ]
    const roots = nextRouterRoots({ files }, 'app')
    expect(nearestNextRoot(roots, files[3])).toBe('/r/app/example/app')
    expect(nearestNextRoot(roots, files[4])).toBeNull()
  })

  it('selects app and pages directories independently', () => {
    const tree = { files: ['/r/app/page.tsx', '/r/src/pages/index.tsx'], nextAppRoots: ['/r'] }
    expect(nearestNextRoot(nextRouterRoots(tree, 'app'), '/r/app/page.tsx')).toBe('/r/app')
    expect(nearestNextRoot(nextRouterRoots(tree, 'pages'), '/r/src/pages/index.tsx')).toBe('/r/src/pages')
  })
})
