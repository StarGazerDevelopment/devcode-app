import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import chokidar from 'chokidar'

import { buildTree, listDir, mkdirp, readFile, removePath, renamePath, writeFile } from './lib/fs.mjs'
import { createGroqClient, defaultModel, runAgent } from './lib/ai.mjs'
import { ensureProjectData, listChats, readChat, writeChat } from './lib/storage.mjs'
import { getRun, killRun, startRun } from './lib/terminal.mjs'
import { searchText } from './lib/search.mjs'
import os from 'node:os'
import fs from 'node:fs'

const PORT = Number(process.env.DEVCODE_PORT || 3030)
const VITE_ORIGIN = process.env.DEVCODE_WEB_ORIGIN || 'http://localhost:5173'

const app = express()
app.use(cors({ origin: '*', credentials: false }))
app.use(express.json({ limit: '10mb' }))

const DEVCODE_DIR = path.join(os.homedir(), '.devcode')
if (!fs.existsSync(DEVCODE_DIR)) {
  fs.mkdirSync(DEVCODE_DIR, { recursive: true })
}

app.get('/api/update/remind', (req, res) => {
  try {
    const remindFile = path.join(DEVCODE_DIR, 'update_remind.json')
    if (fs.existsSync(remindFile)) {
      const data = JSON.parse(fs.readFileSync(remindFile, 'utf8'))
      res.json({ ok: true, data })
    } else {
      res.json({ ok: true, data: null })
    }
  } catch(e) {
    res.json({ ok: false, error: e.message })
  }
})

app.post('/api/update/remind', (req, res) => {
  try {
    const { date, skippedVersion } = req.body
    const remindFile = path.join(DEVCODE_DIR, 'update_remind.json')
    fs.writeFileSync(remindFile, JSON.stringify({ date, skippedVersion }))
    res.json({ ok: true })
  } catch(e) {
    res.json({ ok: false, error: e.message })
  }
})

let currentProjectRoot = null

function requireProjectRoot() {
  if (!currentProjectRoot) throw new Error('No project open')
  return currentProjectRoot
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/project/open', async (req, res) => {
  try {
    const p = String(req.body?.path || '').trim()
    if (!p) return res.status(400).json({ ok: false, error: 'Missing path' })
    const abs = path.resolve(p)
    currentProjectRoot = abs
    await ensureProjectData(abs)
    res.json({ ok: true, projectRoot: abs })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/project/current', async (_req, res) => {
  res.json({ ok: true, projectRoot: currentProjectRoot })
})

app.get('/api/fs/tree', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const rel = String(req.query?.dir || '.')
    const tree = await buildTree(root, rel, { maxDepth: 8, maxEntries: 5000 })
    res.json({ ok: true, tree })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/fs/list', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const dir = String(req.query?.dir || '.')
    const entries = await listDir(root, dir)
    res.json({ ok: true, entries })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/fs/watch', (req, res) => {
  try {
    const root = requireProjectRoot()
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const send = (type, data) => {
      res.write(`event: ${type}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    const watcher = chokidar.watch(root, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles like .git
      persistent: true,
      ignoreInitial: true
    })

    const onEvent = (event, p) => {
      const rel = path.relative(root, p).replace(/\\/g, '/')
      send('change', { event, path: rel })
    }

    watcher.on('all', onEvent)

    req.on('close', () => {
      watcher.close()
    })
  } catch (e) {
    res.status(500).end()
  }
})

app.get('/api/fs/read', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const p = String(req.query?.path || '')
    if (!p) return res.status(400).json({ ok: false, error: 'Missing path' })
    const content = await readFile(root, p)
    res.json({ ok: true, content })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.post('/api/fs/write', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const p = String(req.body?.path || '')
    const content = String(req.body?.content ?? '')
    if (!p) return res.status(400).json({ ok: false, error: 'Missing path' })
    await writeFile(root, p, content)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.post('/api/fs/mkdir', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const p = String(req.body?.path || '')
    if (!p) return res.status(400).json({ ok: false, error: 'Missing path' })
    await mkdirp(root, p)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.post('/api/fs/delete', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const p = String(req.body?.path || '')
    if (!p) return res.status(400).json({ ok: false, error: 'Missing path' })
    await removePath(root, p)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.post('/api/fs/rename', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const from = String(req.body?.from || '')
    const to = String(req.body?.to || '')
    if (!from || !to) return res.status(400).json({ ok: false, error: 'Missing from/to' })
    await renamePath(root, from, to)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/search', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const q = String(req.query?.q || '')
    const matches = await searchText(root, q)
    res.json({ ok: true, matches })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.post('/api/terminal/run', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const command = String(req.body?.command || '').trim()
    const cwdRel = String(req.body?.cwd || '.')
    if (!command) return res.status(400).json({ ok: false, error: 'Missing command' })
    const cwd = path.resolve(root, cwdRel)
    const run = startRun({ command, cwd })
    res.json({ ok: true, run: { id: run.id, command: run.command, cwd: run.cwd, createdAt: run.createdAt } })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/terminal/run/:id', async (req, res) => {
  try {
    const run = getRun(String(req.params.id))
    if (!run) return res.status(404).json({ ok: false, error: 'Run not found' })
    res.json({ ok: true, run: { id: run.id, status: run.status, exitCode: run.exitCode, urls: run.urls, output: run.output } })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/terminal/stream/:id', async (req, res) => {
  const run = getRun(String(req.params.id))
  if (!run) return res.status(404).end()

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const send = (type, data) => {
    res.write(`event: ${type}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  if (run.output) send('output', { chunk: run.output, urls: run.urls })

  const onData = (chunk) => send('output', { chunk, urls: run.urls })
  const onClose = (code) => {
    send('close', { exitCode: code, urls: run.urls })
    res.end()
  }

  run.emitter.on('data', onData)
  run.emitter.on('close', onClose)

  req.on('close', () => {
    run.emitter.off('data', onData)
    run.emitter.off('close', onClose)
  })
})

app.post('/api/terminal/kill', async (req, res) => {
  try {
    const id = String(req.body?.id || '')
    if (!id) return res.status(400).json({ ok: false, error: 'Missing id' })
    res.json({ ok: true, killed: killRun(id) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/chat/list', async (_req, res) => {
  try {
    const root = requireProjectRoot()
    res.json({ ok: true, chats: await listChats(root) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/chat/:id', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const chat = await readChat(root, String(req.params.id))
    res.json({ ok: true, chat })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.post('/api/chat/:id', async (req, res) => {
  try {
    const root = requireProjectRoot()
    const id = String(req.params.id)
    const chat = req.body?.chat
    if (!chat) return res.status(400).json({ ok: false, error: 'Missing chat' })
    await writeChat(root, id, chat)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.post('/api/ai/chat', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const send = (type, data) => {
    res.write(`event: ${type}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const root = requireProjectRoot()
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : []
    const model = String(req.body?.model || defaultModel())
    const groq = createGroqClient()

    const tools = [
      {
        type: 'function',
        function: {
          name: 'fs_read',
          description: 'Read a UTF-8 text file from the current project',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fs_write',
          description: 'Write a UTF-8 text file in the current project (creates parent directories)',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fs_mkdir',
          description: 'Create a directory (recursive)',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fs_list',
          description: 'List directory entries',
          parameters: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fs_tree',
          description: 'Build a project tree for browsing (limited depth)',
          parameters: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'terminal_run',
          description: 'Run a terminal command. Append --wait to the command to wait for completion and read the output.',
          parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search text in the project',
          parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      },
    ]

    const toolHandlers = {
      fs_read: async ({ path: p }) => ({ content: await readFile(root, p) }),
      fs_write: async ({ path: p, content }) => {
        await writeFile(root, p, content)
        return { written: true }
      },
      fs_mkdir: async ({ path: p }) => {
        await mkdirp(root, p)
        return { created: true }
      },
      fs_list: async ({ dir }) => ({ entries: await listDir(root, dir) }),
      fs_tree: async ({ dir }) => ({ tree: await buildTree(root, dir, { maxDepth: 6, maxEntries: 2000 }) }),
      terminal_run: async ({ command, cwd = '.' }) => {
        const shouldWait = command.includes('--wait')
        const actualCommand = command.replace('--wait', '').trim()
        const run = startRun({ command: actualCommand, cwd: path.resolve(root, cwd) })

        if (shouldWait) {
          return new Promise((resolve) => {
            const timer = setTimeout(() => {
              resolve({
                _system_message: "System message: Command timed out after 60s.",
                output: run.output.slice(-4000)
              })
            }, 60000)

            run.emitter.once('close', (code) => {
              clearTimeout(timer)
              resolve({
                _system_message: `System message: Command finished with exit code ${code}.`,
                output: run.output.slice(-4000)
              })
            })
          })
        }

        return { id: run.id, _system_message: "System message: Command started in background. Output will not be returned." }
      },
      search: async ({ q }) => ({ matches: await searchText(root, q) }),
    }

    const system = {
      role: 'system',
      content:
        'You are devcode, an AI coding agent inside a local coding platform. Use tools for reading/writing files and running commands when needed. If you need to see the output of a command (like checking tests, ls, or git status), append --wait to your command. The system will reply with the terminal output as a system message. Be transparent about changes.',
    }

    const { transcript, message } = await runAgent({
      groq,
      model,
      messages: [system, ...messages],
      tools,
      toolHandlers,
      onToken: (token) => send('token', { text: token })
    })

    send('done', { message, transcript })
    res.end()
  } catch (e) {
    send('error', { error: e?.message || String(e) })
    res.end()
  }
})

const server = app.listen(PORT, () => {
  // intentionally empty
})

import { WebSocketServer } from 'ws'
import { setupPty } from './lib/terminal.mjs'

const wss = new WebSocketServer({ server, path: '/api/terminal/pty' })
setupPty(wss)
