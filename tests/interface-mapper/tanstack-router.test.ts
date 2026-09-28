/** TanStack route declarations must yield reachable screens, not layout IDs. */
import { describe, expect, it } from 'vitest'
import { analyzeFileContent } from '../../packages/source-facts/src/file-analyzer'
import { deriveWebPlacesFromTree } from '../../packages/interface-mapper/src/web-tree'

function route(id: string, options = 'component: Page', file = '/r/apps/web/src/routes/page.tsx') {
  return analyzeFileContent(file, `
    import { createFileRoute } from '@tanstack/react-router'
    export const Route = createFileRoute('${id}')({ ${options} })
  `, 'tsx')
}

const addresses = (...files: ReturnType<typeof route>[]) => deriveWebPlacesFromTree(files).map(p => p.address)

describe('TanStack file routes', () => {
  it('reads declared route IDs, including groups, pathless parents, index and parameters', () => {
    expect(addresses(
      route('/_home/'),
      route('/(app)/_authenticated/dashboard/resumes/'),
      route('/posts_/$postId/edit'),
      route('/builder/$resumeId/', 'component: lazyRouteComponent(() => import("./page"))'),
    )).toEqual(['/', '/builder/{resumeId}', '/dashboard/resumes', '/posts/{postId}/edit'])
  })

  it('does not invent screens for loaders, redirects, pathless layouts or splats', () => {
    expect(addresses(
      route('/api/data', 'loader: () => fetchData()'),
      route('/dashboard/', 'beforeLoad: () => { throw redirect({ to: "/dashboard/resumes" }) }'),
      route('/_home'),
      route('/(app)'),
      route('/templates/$'),
      route('/empty', 'component: undefined'),
      route('/empty-null', 'component: null'),
    )).toEqual([])
  })

  it('respects the served app and folds duplicate addresses', () => {
    const places = deriveWebPlacesFromTree([
      route('/builder/$id'), route('/builder/$resumeId/'),
      route('/other', 'component: Other', '/r/apps/admin/src/routes/other.tsx'),
    ], { appRoot: '/r/apps/web' })
    expect(places).toMatchObject([{ address: '/builder/{id}', idiom: 'tanstack-router' }])
  })

  it('recognizes imported aliases, namespaces and lazy route components', () => {
    const file = analyzeFileContent('/r/routes.tsx', `
      import { createFileRoute as fileRoute } from '@tanstack/react-router'
      import * as router from '@tanstack/solid-router'
      import { createLazyFileRoute } from '@tanstack/react-router'
      export const A = fileRoute('/one')({ component: One })
      export const B = router.createFileRoute('/two')({ component() { return <Two/> } })
      export const C = createLazyFileRoute('/three')({ component: Three })
    `, 'tsx')
    expect(addresses(file)).toEqual(['/one', '/three', '/two'])
  })

  it('requires a runtime TanStack factory import and a literal route ID', () => {
    const file = analyzeFileContent('/r/unrelated.tsx', `
      import { Link } from '@tanstack/react-router'
      import { createFileRoute } from 'another-router'
      import type { createLazyFileRoute } from '@tanstack/react-router'
      const a = createFileRoute('/fake')({ component: Page })
      const b = createLazyFileRoute('/type-only')({ component: Page })
    `, 'tsx')
    const dynamic = analyzeFileContent('/r/dynamic.tsx', `
      import { createFileRoute } from '@tanstack/react-router'
      const a = createFileRoute(routeId)({ component: Page })
      const b = createFileRoute('/only-a-factory')
      const c = createFileRoute('relative')({ component: Page })
    `, 'tsx')
    expect(addresses(file, dynamic)).toEqual([])
  })
})
