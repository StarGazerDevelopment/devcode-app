import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectHash, GLOBAL_DIR } from './global.mjs'

export function projectDataDir(projectRoot) {
  const hash = getProjectHash(projectRoot)
  const baseName = path.basename(projectRoot)
  return path.join(GLOBAL_DIR, 'chats', `${baseName}_${hash}`)
}

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export async function ensureProjectData(projectRoot) {
  const dir = projectDataDir(projectRoot)
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(path.join(dir, 'chats'), { recursive: true })
  await fs.mkdir(path.join(dir, 'runs'), { recursive: true })
}

export async function listChats(projectRoot) {
  await ensureProjectData(projectRoot)
  const dir = path.join(projectDataDir(projectRoot), 'chats')
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const ids = entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name.replace(/\.json$/, ''))
  ids.sort()
  return ids
}

export async function readChat(projectRoot, chatId) {
  await ensureProjectData(projectRoot)
  const filePath = path.join(projectDataDir(projectRoot), 'chats', `${chatId}.json`)
  return await readJsonSafe(filePath, { id: chatId, messages: [] })
}

export async function writeChat(projectRoot, chatId, chat) {
  await ensureProjectData(projectRoot)
  const filePath = path.join(projectDataDir(projectRoot), 'chats', `${chatId}.json`)
  await fs.writeFile(filePath, JSON.stringify(chat, null, 2), 'utf8')
}
