import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import os from 'node:os'
import pty from 'node-pty'

import fs from 'node:fs'

const runs = new Map()

function extractUrls(text) {
  const urls = []
  const re = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s'"]*/gi
  for (const m of text.matchAll(re)) urls.push(m[0])
  return [...new Set(urls)]
}

export function getRun(runId) {
  return runs.get(runId) ?? null
}

export function startRun({ command, cwd }) {
  const id = crypto.randomUUID()
  const emitter = new EventEmitter()
  const createdAt = Date.now()
  const record = {
    id,
    command,
    cwd,
    createdAt,
    status: 'running',
    exitCode: null,
    urls: [],
    output: '',
    emitter,
    child: null,
  }
  runs.set(id, record)

  const child = spawn(command, {
    cwd,
    shell: true,
    windowsHide: true,
    env: process.env,
  })
  record.child = child

  const onChunk = (chunk) => {
    const text = chunk.toString('utf8')
    record.output += text
    const found = extractUrls(text)
    if (found.length) {
      const next = [...new Set([...record.urls, ...found])]
      record.urls = next
    }
    emitter.emit('data', text)
  }

  child.stdout.on('data', onChunk)
  child.stderr.on('data', onChunk)
  child.on('close', (code) => {
    record.status = 'done'
    record.exitCode = code ?? 0
    emitter.emit('close', record.exitCode)
    setTimeout(() => runs.delete(id), 1000 * 60 * 60)
  })

  return record
}

export function killRun(runId) {
  const record = runs.get(runId)
  if (!record?.child) return false
  try {
    record.child.kill()
    return true
  } catch {
    return false
  }
}

export function setupPty(wss) {
  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      let cwd = url.searchParams.get('cwd') || process.cwd()
      try {
        if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
          cwd = os.homedir()
        }
      } catch {
        cwd = os.homedir()
      }
      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash'

      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd,
        env: process.env
      })

      ptyProcess.onData((data) => {
        ws.send(data)
      })

      ws.on('message', (msg) => {
        const str = msg.toString()
        if (str.startsWith('{"type":"resize"')) {
          try {
            const { cols, rows } = JSON.parse(str)
            ptyProcess.resize(cols, rows)
          } catch (e) {
            // ignore parse errors
          }
        } else {
          ptyProcess.write(str)
        }
      })

      ws.on('close', () => {
        try {
          ptyProcess.kill()
        } catch (e) {}
      })
    } catch (e) {
      console.error('PTY Setup Error:', e)
      ws.close()
    }
  })
}
