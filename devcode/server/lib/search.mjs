import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_IGNORE_DIRS, resolveInProject } from './paths.mjs'

export async function searchText(projectRoot, query, opts = {}) {
  const { maxMatches = 200, maxFileBytes = 512 * 1024 } = opts
  const q = String(query || '').trim()
  if (!q) return []
  const results = []

  async function walk(relDir) {
    if (results.length >= maxMatches) return
    const absDir = resolveInProject(projectRoot, relDir)
    const entries = await fs.readdir(absDir, { withFileTypes: true })
    for (const e of entries) {
      if (results.length >= maxMatches) return
      if (e.isDirectory() && DEFAULT_IGNORE_DIRS.has(e.name)) continue
      const childRel = path.posix.join(relDir === '.' ? '' : relDir, e.name)
      if (e.isDirectory()) {
        await walk(childRel === '' ? '.' : childRel)
      } else {
        const abs = resolveInProject(projectRoot, childRel)
        const st = await fs.stat(abs).catch(() => null)
        if (!st || st.size > maxFileBytes) continue
        const text = await fs.readFile(abs, 'utf8').catch(() => null)
        if (!text) continue
        const idx = text.toLowerCase().indexOf(q.toLowerCase())
        if (idx >= 0) {
          const start = Math.max(0, idx - 120)
          const end = Math.min(text.length, idx + 240)
          results.push({
            path: childRel,
            index: idx,
            snippet: text.slice(start, end),
          })
        }
      }
    }
  }

  await walk('.')
  return results
}
