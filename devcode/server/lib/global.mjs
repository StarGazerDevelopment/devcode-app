import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

export const GLOBAL_DIR = path.join(os.homedir(), '.devcode')

export function ensureGlobalDir() {
  if (!fs.existsSync(GLOBAL_DIR)) {
    fs.mkdirSync(GLOBAL_DIR, { recursive: true })
  }
}

export function getGlobalSettings() {
  ensureGlobalDir()
  const settingsPath = path.join(GLOBAL_DIR, 'settings.json')
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch {
    return { onboarded: false, theme: 'dark' }
  }
}

export function saveGlobalSettings(settings) {
  ensureGlobalDir()
  const settingsPath = path.join(GLOBAL_DIR, 'settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

export function getGlobalEnv() {
  ensureGlobalDir()
  const envPath = path.join(GLOBAL_DIR, '.env')
  try {
    const raw = fs.readFileSync(envPath, 'utf8')
    const env = {}
    raw.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/)
      if (match) env[match[1].trim()] = match[2].trim()
    })
    return env
  } catch {
    return {}
  }
}

export function saveGlobalEnv(env) {
  ensureGlobalDir()
  const envPath = path.join(GLOBAL_DIR, '.env')
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`)
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8')
}

export function getProjects() {
  ensureGlobalDir()
  const pPath = path.join(GLOBAL_DIR, 'projects.json')
  try {
    return JSON.parse(fs.readFileSync(pPath, 'utf8'))
  } catch {
    return []
  }
}

export function addProject(projectRoot) {
  const projects = getProjects()
  if (!projects.includes(projectRoot) && !projectRoot.endsWith('.devcode')) {
    projects.push(projectRoot)
    const pPath = path.join(GLOBAL_DIR, 'projects.json')
    fs.writeFileSync(pPath, JSON.stringify(projects, null, 2), 'utf8')
  }
  return projects
}

export function getProjectHash(projectRoot) {
  return crypto.createHash('md5').update(projectRoot).digest('hex').substring(0, 12)
}
