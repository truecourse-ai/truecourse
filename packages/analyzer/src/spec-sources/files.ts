import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { SpecBundle, SpecSection } from '../plugins/types.js'

// ---------------------------------------------------------------------------
// File-based spec source
// ---------------------------------------------------------------------------
//
// Discovers prose specifications by convention. Search order (first hit wins
// when an explicit override is set; otherwise all matches are loaded):
//
//   1. Explicit override in `.truecourse/config.json` (`spec` or `spec.paths`)
//   2. Convention: SPEC.md at repo root
//   3. Fallback scan: SPECIFICATION.md, docs/SPEC.md, PRD*.md, REQUIREMENTS.md
//   4. Last-resort: README.md
//
// Each loaded file is split into sections by markdown H1/H2 headings; each
// section has a stable id (`FILE:<path>#<heading-slug>`) and a content hash
// that powers `--diff` (only changed sections re-run discovery).
// ---------------------------------------------------------------------------

const FALLBACK_PATTERNS: { path: string; lastResort?: boolean }[] = [
  { path: 'SPEC.md' },
  { path: 'SPECIFICATION.md' },
  { path: 'docs/SPEC.md' },
  { path: 'docs/spec.md' },
  { path: 'docs/SPECIFICATION.md' },
  { path: 'REQUIREMENTS.md' },
  { path: 'docs/REQUIREMENTS.md' },
  { path: 'README.md', lastResort: true },
]

const PRD_GLOB = /^PRD.*\.md$/i

function readConfigOverride(repoPath: string): string[] | null {
  const configPath = path.join(repoPath, '.truecourse', 'config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const spec = raw?.spec
    if (typeof spec === 'string') return [spec]
    if (Array.isArray(spec?.paths)) return spec.paths
    return null
  } catch {
    return null
  }
}

function findPrdFiles(repoPath: string): string[] {
  const out: string[] = []
  const dirs = [repoPath, path.join(repoPath, 'docs')]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && PRD_GLOB.test(entry.name)) {
        out.push(path.join(dir, entry.name))
      }
    }
  }
  return out
}

function discoverSpecPaths(repoPath: string): { paths: string[]; searched: string[] } {
  const override = readConfigOverride(repoPath)
  if (override && override.length > 0) {
    const resolved = override.map((p) => path.resolve(repoPath, p))
    return {
      paths: resolved.filter((p) => fs.existsSync(p)),
      searched: resolved,
    }
  }

  const searched: string[] = []
  const found: string[] = []
  let nonLastResortFound = false

  for (const { path: rel, lastResort } of FALLBACK_PATTERNS) {
    const abs = path.join(repoPath, rel)
    searched.push(abs)
    if (fs.existsSync(abs)) {
      if (lastResort && nonLastResortFound) continue
      found.push(abs)
      if (!lastResort) nonLastResortFound = true
    }
  }

  // PRD glob — separate scan
  const prds = findPrdFiles(repoPath)
  for (const p of prds) {
    searched.push(p)
    if (!found.includes(p)) {
      found.push(p)
      nonLastResortFound = true
    }
  }

  // If anything non-last-resort was found, drop the README.md fallback
  if (nonLastResortFound) {
    return {
      paths: found.filter((p) => !p.endsWith('README.md')),
      searched,
    }
  }
  return { paths: found, searched }
}

// ---------------------------------------------------------------------------
// Markdown section parser
// ---------------------------------------------------------------------------

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function parseMarkdownSections(filePath: string, raw: string, repoPath: string): SpecSection[] {
  const rel = path.relative(repoPath, filePath)
  const lines = raw.split('\n')
  const sections: { heading: string; lines: string[] }[] = []
  let current: { heading: string; lines: string[] } = { heading: rel, lines: [] }

  for (const line of lines) {
    const m = /^(#{1,2})\s+(.+?)\s*$/.exec(line)
    if (m) {
      if (current.lines.length > 0 || current.heading !== rel) {
        sections.push(current)
      }
      current = { heading: m[2], lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.length > 0 || sections.length === 0) {
    sections.push(current)
  }

  return sections.map((s) => {
    const content = s.lines.join('\n').trim()
    return {
      id: `FILE:${rel}#${slugify(s.heading)}`,
      origin: 'file',
      sourcePath: rel,
      heading: s.heading,
      content,
      contentHash: hashContent(content),
    } satisfies SpecSection
  })
}

// ---------------------------------------------------------------------------
// Public entry — load spec for a repo
// ---------------------------------------------------------------------------

export function loadSpecBundle(repoPath: string): SpecBundle {
  const { paths, searched } = discoverSpecPaths(repoPath)
  const sections: SpecSection[] = []
  for (const p of paths) {
    const raw = fs.readFileSync(p, 'utf-8')
    sections.push(...parseMarkdownSections(p, raw, repoPath))
  }
  return {
    sections,
    searchedPaths: searched.map((p) => path.relative(repoPath, p)),
    empty: sections.length === 0,
  }
}
