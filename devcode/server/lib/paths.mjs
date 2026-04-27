import path from 'node:path'

export const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.devcode',
])

export function normalizeRel(p) {
  if (!p || p === '.') return '.'
  const normalized = p.replaceAll('\\', '/')
  const noLeading = normalized.replace(/^\/+/, '')
  const clean = path.posix.normalize(noLeading)
  if (clean.startsWith('..')) throw new Error('Path escapes project root')
  return clean
}

export function resolveInProject(projectRoot, relPath) {
  const clean = normalizeRel(relPath)
  const abs = path.resolve(projectRoot, clean)
  const root = path.resolve(projectRoot)
  if (!abs.startsWith(root + path.sep) && abs !== root) throw new Error('Path escapes project root')
  return abs
}
