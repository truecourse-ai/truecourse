/** Filesystem conventions shared by Next web and API discovery. Paths use `/`. */
export const NEXT_CONFIG = /^next\.config\.(?:js|mjs|ts|mts)$/

export function manifestDeclaresNext(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== 'object') return false
  const value = manifest as Record<string, Record<string, unknown> | undefined>
  return typeof value.dependencies?.next === 'string' || typeof value.devDependencies?.next === 'string'
}

export interface NextRouteTree {
  files: readonly string[]
  nextAppRoots?: readonly string[]
}

export interface NextRouterRoot {
  appRoot: string
  routerRoot: string
}

export function nextRouterRoots(tree: NextRouteTree, router: 'app' | 'pages'): NextRouterRoot[] {
  const appRoots = new Set(tree.nextAppRoots ?? [])
  for (const file of tree.files) {
    const cut = file.lastIndexOf('/')
    if (NEXT_CONFIG.test(file.slice(cut + 1))) appRoots.add(cut < 0 ? '' : file.slice(0, cut))
  }
  return [...appRoots].map((root) => {
    const prefix = root ? `${root}/` : ''
    const direct = `${prefix}${router}`
    return {
      appRoot: root,
      routerRoot: tree.files.some((file) => file.startsWith(`${direct}/`)) ? direct : `${prefix}src/${router}`,
    }
  }).sort((a, b) => b.appRoot.length - a.appRoot.length)
}

export function nearestNextRoot(roots: readonly NextRouterRoot[], filePath: string): string | null {
  // Select the app first: an ignored src/app in a nested app must not fall
  // through to an ancestor's router.
  const owner = roots.find(({ appRoot }) => !appRoot || filePath.startsWith(`${appRoot}/`))
  return owner && filePath.startsWith(`${owner.routerRoot}/`) ? owner.routerRoot : null
}

/** Private folders, parallel slots and interceptions do not declare standalone addresses. */
export function nextAppSegments(directories: readonly string[], optional: 'parent' | 'catch-all' = 'parent'): string[] | null {
  const segments: string[] = []
  for (const directory of directories) {
    if (directory.startsWith('_') || directory.startsWith('@')) return null
    if (/^\((?:\.{1,3})\)/.test(directory)) return null
    if (/^\(.*\)$/.test(directory)) continue
    const segment = nextDynamicSegment(directory, optional)
    if (segment !== null) segments.push(segment)
  }
  return segments
}

export function nextDynamicSegment(name: string, optional: 'parent' | 'catch-all' = 'parent'): string | null {
  const optionalCatchAll = /^\[\[\.\.\.(.+)\]\]$/.exec(name)
  if (optionalCatchAll) return optional === 'parent' ? null : `{...${optionalCatchAll[1]}}`
  const catchAll = /^\[\.\.\.(.+)\]$/.exec(name)
  if (catchAll) return `{...${catchAll[1]}}`
  const slot = /^\[(.+)\]$/.exec(name)
  if (slot) return `{${slot[1]}}`
  // Next permits escaping a leading underscore to make a public URL segment.
  return name.replace(/^%5[fF]/, '_')
}
