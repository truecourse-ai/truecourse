/**
 * The web-route reader — React Router's JSX declaration, the one web-routing
 * idiom that is written as CODE rather than as a directory tree. The two
 * file-system idioms (Next.js, remix-flat-routes) carry no AST at all and are
 * read in the mapper, where the whole tree is visible.
 *
 * The invariants under test are the two the api extractor learned the hard way:
 * a `<Route>` is only a route when the file is a React Router file, and a route
 * whose address cannot be composed is not emitted at all.
 */

import { describe, it, expect } from 'vitest'
import { extractWebRoutes } from '../../packages/analyzer/src/extractors/web-routes'
import { parseCode } from '../../packages/analyzer/src/parser'

function routesOf(code: string, filePath = '/src/App.tsx') {
  const tree = parseCode(code, 'tsx')
  return extractWebRoutes(tree, filePath, 'tsx').map((r) => r.path)
}

describe('React Router JSX routes', () => {
  it('reads every absolutely-addressed Route element', () => {
    // Shape drawn from this repo's own dashboard client.
    expect(
      routesOf(`
        import { BrowserRouter, Routes, Route } from 'react-router-dom'

        export function App() {
          return (
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/repos/:repoId" element={<RepoPage />} />
            </Routes>
          )
        }
      `),
    ).toEqual(['/', '/repos/:repoId'])
  })

  it('composes a nested Route onto the address of the Route it sits in', () => {
    expect(
      routesOf(`
        import { Route, Routes } from 'react-router'

        export const App = () => (
          <Routes>
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Overview />} />
              <Route path="members" element={<Members />} />
              <Route path="members/:memberId" element={<Member />} />
            </Route>
          </Routes>
        )
      `),
    ).toEqual(['/settings', '/settings/members', '/settings/members/:memberId'])
  })

  it('drops a Route no absolute address composes — a relative fragment is not an address', () => {
    // Strapi's admin plugin shape: a route table mounted somewhere this file
    // does not name. Emitting `/:collectionType/:slug` would be a screen no
    // navigate step could ever reach.
    expect(
      routesOf(`
        import { Route } from 'react-router-dom'

        export const PluginRoutes = () => (
          <>
            <Route path=":collectionType/:slug" element={<ListView />} />
          </>
        )
      `),
    ).toEqual([])
  })

  it('drops a path it cannot read — an expression is not a literal', () => {
    expect(
      routesOf(`
        import { Route, Routes } from 'react-router-dom'

        export const App = () => (
          <Routes>
            <Route path="/" element={<Home />} />
            {extra.map(({ path, Component }) => (
              <Route key={path} path={path} element={<Component />} />
            ))}
          </Routes>
        )
      `),
    ).toEqual(['/'])
  })

  it('stays silent in a file that never imports React Router', () => {
    // `Route` is an ordinary component name — a file that does not import the
    // library is not declaring the app's routes, whatever it calls its elements.
    expect(
      routesOf(`
        export const Legend = () => (
          <svg>
            <Route path="/leaflet/polyline" stroke="red" />
          </svg>
        )
      `),
    ).toEqual([])
  })

  it('reads a self-closing and a wrapping Route alike, and ignores a pathless layout', () => {
    expect(
      routesOf(`
        import { Route } from 'react-router-dom'

        export const App = () => (
          <Route path="/" element={<Shell />}>
            <Route element={<Chrome />}>
              <Route path="/inbox" element={<Inbox />} />
            </Route>
          </Route>
        )
      `),
    ).toEqual(['/', '/inbox'])
  })
})
