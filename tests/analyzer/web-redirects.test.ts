/**
 * The redirect readers — the two ways an address stays in the routing and stops
 * being a place. Both gates are what these tests are about: a pattern source or
 * a `has` condition redirects SOME visitors, and a module that redirects behind
 * an `if` renders for the rest. Dropping a place on either would delete screens
 * the app serves, so the facts recorded have to say which kind they are.
 *
 * Shapes are drawn from the cal.diy and documenso checkouts.
 */

import { describe, it, expect } from 'vitest'
import { extractWebRedirects } from '../../packages/analyzer/src/extractors/web-redirects'
import { parseCode } from '../../packages/analyzer/src/parser'
import type { SupportedLanguage } from '../../packages/shared/src/index'

function redirectsOf(code: string, filePath = '/r/apps/web/next.config.ts') {
  return extractWebRedirects(parseCode(code, 'typescript'), filePath, 'typescript').redirects
}

function onlyRedirects(code: string, language: SupportedLanguage = 'tsx') {
  const tree = parseCode(code, language === 'tsx' ? 'tsx' : 'typescript')
  return extractWebRedirects(tree, '/r/app/routes/dashboard.tsx', language).redirectsUnconditionally
}

describe('the config redirect table', () => {
  it('reads the literal entries of `redirects()`', () => {
    expect(
      redirectsOf(`
        const nextConfig = {
          async redirects() {
            return [
              { source: '/bookings', destination: '/bookings/upcoming', permanent: true },
              { source: '/settings', destination: '/settings/my-account/profile', permanent: false },
            ]
          },
        }
        export default nextConfig
      `),
    ).toEqual([
      { source: '/bookings', destination: '/bookings/upcoming', permanent: true },
      { source: '/settings', destination: '/settings/my-account/profile', permanent: false },
    ])
  })

  it('reads the arrow form and quoted keys', () => {
    expect(
      redirectsOf(`
        module.exports = {
          redirects: async () => [{ 'source': '/apps', 'destination': '/apps/installed' }],
        }
      `),
    ).toEqual([{ source: '/apps', destination: '/apps/installed' }])
  })

  it('marks a conditioned entry, whose address still renders for everyone else', () => {
    expect(
      redirectsOf(`
        const nextConfig = {
          async redirects() {
            return [
              {
                source: '/:path*',
                has: [{ type: 'header', key: 'x-embed' }],
                destination: '/embed/:path*',
                permanent: false,
              },
            ]
          },
        }
      `),
    ).toEqual([
      { source: '/:path*', destination: '/embed/:path*', permanent: false, conditional: true },
    ])
  })

  it('says nothing about the table next to it — `rewrites` is not a redirect', () => {
    expect(
      redirectsOf(`
        const nextConfig = {
          async rewrites() {
            return [{ source: '/api/:path*', destination: 'https://api.example.com/:path*' }]
          },
        }
      `),
    ).toEqual([])
  })

  it('skips an entry whose addresses are not literals', () => {
    expect(
      redirectsOf(`
        const nextConfig = {
          async redirects() {
            return [
              { source: legacy.path, destination: '/home', permanent: true },
              { source: '/help', destination: DOCS_URL, permanent: true },
            ]
          },
        }
      `),
    ).toEqual([])
  })

  it('says nothing about a file that is not a framework config', () => {
    expect(
      redirectsOf(
        `export const config = { redirects: async () => [{ source: '/a', destination: '/b' }] }`,
        '/r/apps/web/lib/config.ts',
      ),
    ).toEqual([])
  })
})

describe('a module whose whole body is one redirect', () => {
  it('flags a loader that only throws a redirect, component below it or not', () => {
    // documenso's `dashboard.tsx` verbatim: a full page component nobody reaches.
    expect(
      onlyRedirects(`
        import { redirect } from 'react-router'

        export function loader() {
          throw redirect('/documents');
        }

        export default function DashboardPage() {
          return <div>Dashboard</div>
        }
      `),
    ).toBe(true)
  })

  it('flags the return form, and the arrow that returns it', () => {
    expect(onlyRedirects(`export async function loader() { return redirect('/settings') }`)).toBe(true)
    expect(onlyRedirects(`export const loader = async () => redirect('/settings')`)).toBe(true)
  })

  it('flags a page whose default export does nothing but redirect', () => {
    expect(
      onlyRedirects(`
        import { redirect } from 'next/navigation'
        export default function Page() {
          redirect('/bookings/upcoming')
        }
      `),
    ).toBe(true)
    expect(onlyRedirects(`export default async function () { throw redirect('/login') }`)).toBe(true)
  })

  it('does NOT flag a conditional redirect — the module renders when the branch is not taken', () => {
    // documenso's `certificate.tsx`: redirects when the feature is off, renders otherwise.
    expect(
      onlyRedirects(`
        export function loader() {
          if (!env('NEXT_PRIVATE_SIGNING_CERTIFICATE')) {
            throw redirect('/');
          }
          return { certificate: true }
        }

        export default function CertificatePage() {
          return <Certificate />
        }
      `),
    ).toBe(false)
  })

  it('does NOT flag a loader that redirects after doing anything else', () => {
    expect(
      onlyRedirects(`
        export async function loader({ request }) {
          const session = await getSession(request)
          throw redirect(session ? '/documents' : '/signin')
        }
      `),
    ).toBe(false)
  })

  it('does NOT flag an ordinary screen', () => {
    expect(
      onlyRedirects(`
        export default function SignInPage() {
          return <SignInForm />
        }
      `),
    ).toBe(false)
  })

  it('asks nothing of a helper export that happens to redirect', () => {
    expect(onlyRedirects(`export function requireAuth() { throw redirect('/signin') }`)).toBe(false)
  })
})

describe('the languages the readers speak', () => {
  it('says nothing about a language with no web-routing idiom', () => {
    const tree = parseCode(`def loader():\n    raise redirect('/x')\n`, 'python')
    expect(extractWebRedirects(tree, '/r/app/routes.py', 'python')).toEqual({
      redirects: [],
      redirectsUnconditionally: false,
    })
  })
})
