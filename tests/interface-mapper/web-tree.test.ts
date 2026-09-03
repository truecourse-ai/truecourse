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

/**
 * A FileAnalysis carrying only what the web readers look at. It default-exports
 * a component, because that is what a route module does — the registry drops one
 * that renders nothing, so a fixture standing in for a screen has to render.
 * {@link handler} is the fixture for the module that does not.
 */
function file(filePath: string, extra: Partial<FileAnalysis> = {}): FileAnalysis {
  return {
    filePath,
    language: filePath.endsWith('x') ? 'tsx' : 'typescript',
    functions: [],
    classes: [],
    imports: [],
    exports: [{ name: 'Page', isDefault: true }],
    calls: [],
    httpCalls: [],
    ...extra,
  }
}

/** A route module that serves a RESPONSE — a `loader`, and no component. */
function handler(filePath: string): FileAnalysis {
  return file(filePath, { exports: [{ name: 'loader', isDefault: false }] })
}

/** The `next.config.js` whose presence claims a Next.js app root. */
function nextConfig(dir: string, webRedirects: FileAnalysis['webRedirects'] = undefined): FileAnalysis {
  return file(`${dir}/next.config.js`, {
    language: 'javascript',
    ...(webRedirects ? { webRedirects } : {}),
  })
}

/** A route module whose whole body is one redirect — the analyzer's flag, set. */
function redirecting(filePath: string): FileAnalysis {
  return file(filePath, { redirectsUnconditionally: true })
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

/**
 * A PLACE IS AN ADDRESS WHOSE MODULE RENDERS. The three file-system idioms put
 * the route and its component in ONE module, so the module's own exports settle
 * whether an address is somewhere a user can stand or somewhere the server
 * answers. Measured on the documenso checkout: 15 of the 125 addresses that
 * passed for screens render nothing — ten `api+/*` handlers, an opengraph image,
 * and four index routes whose loader redirects.
 */
describe('a route module that renders nothing is not a place', () => {
  it('drops a remix route module that exports a loader and no component', () => {
    expect(
      addresses([
        flatRoutesConfig('/r/apps/remix/app'),
        file('/r/apps/remix/app/routes/inbox.tsx'),
        handler('/r/apps/remix/app/routes/api+/health.ts'),
        handler('/r/apps/remix/app/routes/_share+/share.$slug.opengraph.tsx'),
      ]),
    ).toEqual(['/inbox'])
  })

  it('drops an index route whose loader only redirects', () => {
    expect(
      addresses([
        flatRoutesConfig('/r/apps/remix/app'),
        handler('/r/apps/remix/app/routes/_authenticated+/settings+/_index.tsx'),
        file('/r/apps/remix/app/routes/_authenticated+/settings+/profile.tsx'),
      ]),
    ).toEqual(['/settings/profile'])
  })

  it('drops a Next.js page module with no default export, in either router', () => {
    expect(
      addresses([
        nextConfig('/r/apps/web'),
        file('/r/apps/web/app/bookings/page.tsx'),
        handler('/r/apps/web/app/health/page.tsx'),
        handler('/r/apps/web/pages/ping.tsx'),
      ]),
    ).toEqual(['/bookings'])
  })

  /**
   * The React Router idiom declares its routes in a JSX TABLE, so `filePath` is
   * the table and the component lives elsewhere. Asking the table for a default
   * export would refuse every place the idiom produces.
   */
  it('asks nothing of a react-router table, whose component is another file', () => {
    expect(
      addresses([
        file('/r/admin/src/router.tsx', {
          exports: [{ name: 'routes', isDefault: false }],
          webRoutes: [{ path: '/content-manager', location: loc('/r/admin/src/router.tsx') }],
        }),
      ]),
    ).toEqual(['/content-manager'])
  })

  /**
   * The rule reads the module's exports in EVERY form the analyzer records one,
   * which is the half of this that lives in the analyzer: `export default Page;`
   * is how 74 of cal.diy's 79 route modules are written, and it was invisible
   * until `extractExportName` learned the value form.
   */
  it('accepts a default export however it is written', () => {
    const config = nextConfig('/r/apps/web')
    for (const exported of [
      { name: 'Page', isDefault: true }, // export default function Page()
      { name: 'default', isDefault: true }, // export default memo(Page)
    ]) {
      expect(
        addresses([config, file('/r/apps/web/app/inbox/page.tsx', { exports: [exported] })]),
      ).toEqual(['/inbox'])
    }
  })
})

/**
 * AN ADDRESS THAT REDIRECTS IS NOT A PLACE EITHER. The exports gate reads what a
 * module EXPORTS, and both of these pass it: documenso's `dashboard.tsx` exports
 * a full page component behind a `loader` that throws `redirect('/documents')`,
 * and cal.diy's `/bookings` has no module at all — `next.config.ts` answers it
 * with a permanent redirect to `/bookings/upcoming`. Each is an authoring
 * session spent on a screen nobody can open.
 *
 * The other half is what must NOT be dropped: documenso's `certificate.tsx`
 * redirects only when a feature flag is off and genuinely renders otherwise, and
 * a pattern or conditioned config source redirects a FAMILY of addresses that
 * the app still serves screens under. The analyzer says which kind each fact is;
 * this registry drops only the unconditional, exactly-addressed ones.
 */
describe('an address the app redirects away is not a place', () => {
  it('drops a route module whose whole body is one redirect, component or not', () => {
    expect(
      addresses([
        flatRoutesConfig('/r/apps/remix/app'),
        redirecting('/r/apps/remix/app/routes/_authenticated+/dashboard.tsx'),
        file('/r/apps/remix/app/routes/_authenticated+/documents._index.tsx'),
      ]),
    ).toEqual(['/documents'])
  })

  it('keeps a module whose redirect is conditional — it renders for somebody', () => {
    // `certificate.tsx`: the analyzer sets no flag, and no fact refuses nothing.
    expect(
      addresses([
        flatRoutesConfig('/r/apps/remix/app'),
        file('/r/apps/remix/app/routes/_internal+/[__htmltopdf]+/certificate.tsx'),
      ]),
    ).toEqual(['/__htmltopdf/certificate'])
  })

  it('drops an address a static config source redirects away', () => {
    expect(
      addresses([
        nextConfig('/r/apps/web', [
          { source: '/bookings', destination: '/bookings/upcoming', permanent: true },
        ]),
        file('/r/apps/web/app/(main)/bookings/page.tsx'),
        file('/r/apps/web/app/(main)/bookings/[status]/page.tsx'),
      ]),
    ).toEqual(['/bookings/{status}'])
  })

  it('keeps an address whose redirect is conditioned on `has`', () => {
    expect(
      addresses([
        nextConfig('/r/apps/web', [
          { source: '/bookings', destination: '/embed/bookings', permanent: false, conditional: true },
        ]),
        file('/r/apps/web/app/bookings/page.tsx'),
      ]),
    ).toEqual(['/bookings'])
  })

  it('keeps every address under a PATTERN source, which redirects a family', () => {
    // `/:user/:type` spans real screens; dropping on it would delete them all.
    expect(
      addresses([
        nextConfig('/r/apps/web', [
          { source: '/:path*', destination: '/maintenance', permanent: false },
          { source: '/event-types/:id', destination: '/event-types', permanent: true },
        ]),
        file('/r/apps/web/app/event-types/[id]/page.tsx'),
        file('/r/apps/web/app/settings/page.tsx'),
      ]),
    ).toEqual(['/event-types/{id}', '/settings'])
  })

  it('applies a config to its OWN app, not to the one beside it', () => {
    // Both apps declare `/bookings`; only the one whose config redirects it loses
    // the place, so the survivor has to be the OTHER app's module.
    const places = deriveWebPlacesFromTree([
      nextConfig('/r/apps/web', [
        { source: '/bookings', destination: '/bookings/upcoming', permanent: true },
      ]),
      file('/r/apps/web/app/bookings/page.tsx'),
      nextConfig('/r/packages/examples/base'),
      file('/r/packages/examples/base/src/pages/bookings.tsx'),
    ])
    expect(places.map((p) => p.filePath)).toEqual(['/r/packages/examples/base/src/pages/bookings.tsx'])
  })
})

/**
 * ONE MONOREPO, SEVERAL ROUTABLE APPS. cal.com's checkout has four Next.js apps,
 * and the bundled platform demo (`packages/platform/examples/base`) declares
 * seven addresses `apps/web` never does — `/troubleshooter`, `/calendar-view`,
 * `/conferencing-apps`, a bare `/bookings`. No fact in the tree says which app is
 * driven; the recipe does, or nobody does.
 */
describe('the app the recipe serves', () => {
  const monorepo = () => [
    nextConfig('/r/apps/web'),
    file('/r/apps/web/app/(main)/bookings/[status]/page.tsx'),
    file('/r/apps/web/app/event-types/page.tsx'),
    nextConfig('/r/packages/platform/examples/base'),
    file('/r/packages/platform/examples/base/src/pages/bookings.tsx'),
    file('/r/packages/platform/examples/base/src/pages/troubleshooter.tsx'),
  ]

  it('keeps every app when the recipe names none — no claim drops nothing', () => {
    expect(addresses(monorepo())).toEqual([
      '/bookings',
      '/bookings/{status}',
      '/event-types',
      '/troubleshooter',
    ])
  })

  it('keeps only the served app’s places when it does', () => {
    expect(
      deriveWebPlacesFromTree(monorepo(), { appRoot: '/r/apps/web' }).map((p) => p.address),
    ).toEqual(['/bookings/{status}', '/event-types'])
  })

  it('matches on the directory, not on a path prefix', () => {
    // `/r/apps/web-legacy` is not inside `/r/apps/web`.
    expect(
      deriveWebPlacesFromTree(
        [nextConfig('/r/apps/web-legacy'), file('/r/apps/web-legacy/app/page.tsx')],
        { appRoot: '/r/apps/web' },
      ),
    ).toEqual([])
  })
})
