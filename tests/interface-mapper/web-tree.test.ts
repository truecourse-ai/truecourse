/**
 * WEB PLACES — the addresses a navigate step can reach, read off the tree.
 *
 * Three idioms, and the gates are what these tests are mostly about: two of the
 * three express a route as a FILE PATH, and a file path is the cheapest thing in
 * the world to mistake for one. `packages/core/admin/admin/src/pages/Home/` is
 * not a Next.js pages router, and a plugin's `admin/src/routes/` is not a Remix
 * flat-routes tree — both exist verbatim in the strapi checkout, and an ungated
 * reader mints a screen for every file in them.
 */

import { describe, it, expect } from 'vitest'
import { deriveWebPlacesFromTree } from '../../packages/interface-mapper/src/web-tree'
import type { FileAnalysis } from '../../packages/shared/src/index'

/** A FileAnalysis carrying only what the web readers look at. */
function file(filePath: string, extra: Partial<FileAnalysis> = {}): FileAnalysis {
  return {
    filePath,
    language: filePath.endsWith('x') ? 'tsx' : 'typescript',
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [],
    httpCalls: [],
    ...extra,
  }
}

/** The `next.config.js` whose presence claims a Next.js app root. */
function nextConfig(dir: string): FileAnalysis {
  return file(`${dir}/next.config.js`, { language: 'javascript' })
}

/** The `routes.ts` whose `remix-flat-routes` import claims a flat-routes tree. */
function flatRoutesConfig(appDir: string): FileAnalysis {
  return file(`${appDir}/routes.ts`, {
    imports: [
      {
        source: 'remix-flat-routes',
        specifiers: [{ name: 'flatRoutes', isDefault: false, isNamespace: false }],
        isTypeOnly: false,
      },
    ],
  })
}

const addresses = (analyses: FileAnalysis[]): string[] =>
  deriveWebPlacesFromTree(analyses).map((p) => p.address)

describe('Next.js app router', () => {
  it('reads the directory tree as the address, groups contributing nothing', () => {
    // Shapes drawn verbatim from the cal.diy checkout.
    expect(
      addresses([
        nextConfig('/r/apps/web'),
        file('/r/apps/web/app/page.tsx'),
        file('/r/apps/web/app/reschedule/[uid]/page.tsx'),
        file('/r/apps/web/app/(booking-page-wrapper)/[user]/[type]/page.tsx'),
        file('/r/apps/web/app/(use-page-wrapper)/(main-nav)/bookings/[status]/page.tsx'),
        file('/r/apps/web/app/(booking-page-wrapper)/d/[link]/[slug]/page.tsx'),
      ]),
    ).toEqual([
      '/',
      '/bookings/{status}',
      '/d/{link}/{slug}',
      '/reschedule/{uid}',
      '/{user}/{type}',
    ])
  })

  it('reads the catch-all forms, the optional one addressing its own parent', () => {
    expect(
      addresses([
        nextConfig('/r/apps/docs'),
        file('/r/apps/docs/app/[[...mdxPath]]/page.tsx'),
        file('/r/apps/docs/app/docs/[...slug]/page.tsx'),
      ]),
    ).toEqual(['/', '/docs/{...slug}'])
  })

  it('leaves out what Next.js does not route: private folders, slots, interceptions, handlers', () => {
    expect(
      addresses([
        nextConfig('/r'),
        file('/r/app/_components/page.tsx'),
        file('/r/app/@modal/settings/page.tsx'),
        file('/r/app/(.)photo/[id]/page.tsx'),
        file('/r/app/api/webhook/route.ts'),
        file('/r/app/dashboard/layout.tsx'),
      ]),
    ).toEqual([])
  })

  it('says nothing without a Next.js app root — `page.tsx` is a filename, not a framework', () => {
    expect(addresses([file('/r/src/app/page.tsx'), file('/r/src/app/inbox/page.tsx')])).toEqual([])
  })
})

describe('Next.js pages router', () => {
  it('reads the pages tree, index addressing its directory', () => {
    expect(
      addresses([
        nextConfig('/r/apps/web'),
        file('/r/apps/web/pages/router/index.tsx'),
        file('/r/apps/web/pages/router/embed.tsx'),
        file('/r/apps/web/pages/_app.tsx'),
        file('/r/apps/web/pages/api/trpc/[trpc].ts'),
      ]),
    ).toEqual(['/router', '/router/embed'])
  })

  it('says nothing about a `src/pages` directory that is a component folder', () => {
    // strapi's admin panel, where `pages/` holds `HomePage.tsx` and friends and
    // no Next.js config exists anywhere above it.
    expect(
      addresses([
        file('/r/packages/core/admin/admin/src/pages/Home/HomePage.tsx'),
        file('/r/packages/core/admin/admin/src/pages/ProfilePage.tsx'),
      ]),
    ).toEqual([])
  })
})

describe('remix-flat-routes', () => {
  it('reads the flat-file convention: dots split, `+` folders nest, `_` prefixes are pathless', () => {
    // Shapes drawn verbatim from the documenso checkout.
    expect(
      addresses([
        flatRoutesConfig('/r/apps/remix/app'),
        file('/r/apps/remix/app/routes/_index.tsx'),
        file('/r/apps/remix/app/routes/_recipient+/sign.$token+/_index.tsx'),
        file('/r/apps/remix/app/routes/_recipient+/sign.$token+/complete.tsx'),
        file('/r/apps/remix/app/routes/_authenticated+/t.$teamUrl+/documents._index.tsx'),
        file('/r/apps/remix/app/routes/_authenticated+/t.$teamUrl+/documents.$id._index.tsx'),
        file('/r/apps/remix/app/routes/_authenticated+/t.$teamUrl+/documents.$id.edit.tsx'),
        file('/r/apps/remix/app/routes/_authenticated+/t.$teamUrl+/settings.tokens.tsx'),
      ]),
    ).toEqual([
      '/',
      '/sign/{token}',
      '/sign/{token}/complete',
      '/t/{teamUrl}/documents',
      '/t/{teamUrl}/documents/{id}',
      '/t/{teamUrl}/documents/{id}/edit',
      '/t/{teamUrl}/settings/tokens',
    ])
  })

  it('leaves out the layouts, escapes bracketed literals, and un-suffixes an opted-out segment', () => {
    expect(
      addresses([
        flatRoutesConfig('/r/app'),
        file('/r/app/routes/_authenticated+/_layout.tsx'),
        file('/r/app/routes/_internal+/[__htmltopdf]+/certificate.tsx'),
        file('/r/app/routes/embed+/v1+/authoring_.completed.create.tsx'),
        file('/r/app/routes/_redirects+/ingest.$.tsx'),
      ]),
    ).toEqual(['/__htmltopdf/certificate', '/embed/v1/authoring/completed/create'])
  })

  it('says nothing about a `routes/` directory no flat-routes config claims', () => {
    // strapi again: `admin/src/routes/` is a React Router table, not a tree.
    expect(
      addresses([
        file('/r/packages/core/content-manager/admin/src/routes/index.ts'),
        file('/r/packages/core/content-manager/admin/src/routes/history.ts'),
      ]),
    ).toEqual([])
  })
})

describe('React Router declarations', () => {
  it('takes the addresses the analyzer read off the JSX', () => {
    expect(
      addresses([
        file('/r/apps/dashboard/client/src/App.tsx', {
          webRoutes: [
            { path: '/', location: loc('/r/apps/dashboard/client/src/App.tsx') },
            { path: '/repos/:repoId', location: loc('/r/apps/dashboard/client/src/App.tsx') },
          ],
        }),
      ]),
    ).toEqual(['/', '/repos/{repoId}'])
  })
})

describe('the registry as a whole', () => {
  it('folds two idioms naming one address into one place, and orders by address', () => {
    const places = deriveWebPlacesFromTree([
      nextConfig('/r/web'),
      file('/r/web/app/inbox/page.tsx'),
      file('/r/web/pages/inbox.tsx'),
    ])
    expect(places.map((p) => p.address)).toEqual(['/inbox'])
    expect(places[0]?.idiom).toBe('next-app')
  })

  it('finds nothing in a repo with no web surface at all', () => {
    expect(addresses([file('/r/src/cli.ts'), file('/r/src/server.ts')])).toEqual([])
  })
})

function loc(filePath: string) {
  return { filePath, startLine: 1, endLine: 1, startColumn: 0, endColumn: 1 }
}

describe('one place per address SHAPE', () => {
  it('folds two spellings of the same slot into one place, keeping the first', () => {
    // A router cannot serve `/[user]` and `/[bookingUid]` at the same position;
    // when both turn up they came from two apps in one monorepo, which is
    // exactly cal.diy (the web app and a bundled platform example).
    const places = deriveWebPlacesFromTree([
      nextConfig('/r/apps/web'),
      file('/r/apps/web/app/[user]/page.tsx'),
      nextConfig('/r/packages/examples/base'),
      file('/r/packages/examples/base/src/pages/[bookingUid].tsx'),
    ])
    expect(places.map((p) => p.address)).toEqual(['/{user}'])
  })
})
