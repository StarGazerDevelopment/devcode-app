import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_IGNORE_DIRS, resolveInProject } from './paths.mjs'

async function statSafe(absPath) {
  try {
    return await fs.stat(absPath)
  } catch {
    return null
  }
}

export async function listDir(projectRoot, relDir) {
  const absDir = resolveInProject(projectRoot, relDir)
  const entries = await fs.readdir(absDir, { withFileTypes: true })
  const out = []
  for (const e of entries) {
    if (e.name.startsWith('.DS_Store')) continue
    const rel = path.posix.join(relDir === '.' ? '' : relDir.replaceAll('\\', '/'), e.name)
    const abs = resolveInProject(projectRoot, rel)
    const st = await statSafe(abs)
    out.push({
      name: e.name,
      path: rel === '' ? e.name : rel,
      type: e.isDirectory() ? 'dir' : 'file',
      size: st?.size ?? null,
      mtimeMs: st?.mtimeMs ?? null,
    })
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}

export async function readFile(projectRoot, relPath) {
  const abs = resolveInProject(projectRoot, relPath)
  return await fs.readFile(abs, 'utf8')
}

export async function writeFile(projectRoot, relPath, content) {
  const abs = resolveInProject(projectRoot, relPath)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

export async function mkdirp(projectRoot, relPath) {
  const abs = resolveInProject(projectRoot, relPath)
  await fs.mkdir(abs, { recursive: true })
}

export async function removePath(projectRoot, relPath) {
  const abs = resolveInProject(projectRoot, relPath)
  const st = await statSafe(abs)
  if (!st) return
  if (st.isDirectory()) await fs.rm(abs, { recursive: true, force: true })
  else await fs.rm(abs, { force: true })
}

export async function renamePath(projectRoot, fromRel, toRel) {
  const fromAbs = resolveInProject(projectRoot, fromRel)
  const toAbs = resolveInProject(projectRoot, toRel)
  await fs.mkdir(path.dirname(toAbs), { recursive: true })
  await fs.rename(fromAbs, toAbs)
}

export async function buildTree(projectRoot, relDir = '.', opts = {}) {
  const { maxDepth = 6, maxEntries = 2500 } = opts
  let count = 0

  async function walk(rel, depth) {
    if (count > maxEntries) return { path: rel, type: 'dir', truncated: true, children: [] }
    const abs = resolveInProject(projectRoot, rel)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    const children = []
    for (const e of entries) {
      if (e.isDirectory() && DEFAULT_IGNORE_DIRS.has(e.name)) continue
      if (e.name === '.devcode') continue
      const childRel = path.posix.join(rel === '.' ? '' : rel, e.name)
      count += 1
      if (e.isDirectory()) {
        if (depth >= maxDepth) {
          children.push({ path: childRel, type: 'dir', truncated: true })
        } else {
          children.push(await walk(childRel, depth + 1))
        }
      } else {
        children.push({ path: childRel, type: 'file' })
      }
      if (count > maxEntries) break
    }
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.path.localeCompare(b.path)
    })
    return { path: rel, type: 'dir', children, truncated: count > maxEntries }
  }

  return await walk(relDir, 0)
}
