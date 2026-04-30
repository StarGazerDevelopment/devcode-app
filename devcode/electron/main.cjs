const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const chokidar = require('chokidar')

const isDev = !app.isPackaged

let serverProcess = null

function getStatePath() {
  return path.join(app.getPath('userData'), 'state.json')
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeState(next) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(getStatePath(), JSON.stringify(next, null, 2))
}

// -----------------------
// Folder Fetch Logic (IPC)
// -----------------------
async function listDir(root, dir) {
  const target = path.resolve(root, dir)
  if (!target.startsWith(root)) throw new Error('Outside root')
  const entries = await fs.promises.readdir(target, { withFileTypes: true })
  return entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
}

async function buildTree(root, relDir, options, currentDepth = 0) {
  const target = path.resolve(root, relDir)
  if (!target.startsWith(root)) throw new Error('Outside root')
  
  if (currentDepth > options.maxDepth) return { path: relDir, type: 'dir', children: [], truncated: true }
  
  const entries = await fs.promises.readdir(target, { withFileTypes: true }).catch(() => [])
  
  if (entries.length > options.maxEntries) {
    return { path: relDir, type: 'dir', children: [], truncated: true }
  }
  
  const children = []
  for (const e of entries) {
    if (e.name.startsWith('.git') || e.name === 'node_modules') continue
    const childRel = relDir === '.' ? e.name : `${relDir}/${e.name}`
    if (e.isDirectory()) {
      children.push(await buildTree(root, childRel, options, currentDepth + 1))
    } else {
      children.push({ path: childRel, type: 'file' })
    }
  }
  return { path: relDir, type: 'dir', children }
}

let activeWatcher = null

function setupWatcher(root, webContents) {
  if (activeWatcher) {
    activeWatcher.close()
  }
  try {
    activeWatcher = chokidar.watch(root, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
      ignorePermissionErrors: true
    })
    
    activeWatcher.on('all', (event, p) => {
      const rel = path.relative(root, p).replace(/\\/g, '/')
      webContents.send('fs:watch:change', { event, path: rel })
    })

    activeWatcher.on('error', (error) => {
      console.error('Watcher error (ignored):', error)
    })
  } catch (err) {
    console.error('Failed to setup watcher:', err)
  }
}

ipcMain.handle('fs:tree', async (e, root, dir) => {
  return await buildTree(root, dir || '.', { maxDepth: 8, maxEntries: 5000 })
})

ipcMain.handle('fs:read', async (e, root, p) => {
  const target = path.resolve(root, p)
  if (!target.startsWith(root)) throw new Error('Outside root')
  return await fs.promises.readFile(target, 'utf8')
})

ipcMain.handle('fs:write', async (e, root, p, content) => {
  const target = path.resolve(root, p)
  if (!target.startsWith(root)) throw new Error('Outside root')
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await fs.promises.writeFile(target, content, 'utf8')
  return true
})

ipcMain.handle('fs:watch', (e, root) => {
  setupWatcher(root, e.sender)
  return true
})

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#ffffff',
    title: 'devcode',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#000000'
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    await win.loadURL('http://localhost:5173/')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  ipcMain.handle('devcode:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Open Project Folder',
    })
    if (result.canceled) return null
    const folderPath = result.filePaths[0]
    const state = readState()
    writeState({ ...state, lastProjectPath: folderPath })
    return folderPath
  })

  ipcMain.handle('devcode:getState', async () => readState())
  ipcMain.handle('devcode:setState', async (_evt, patch) => {
    const state = readState()
    const next = { ...state, ...patch }
    writeState(next)
    return next
  })

  ipcMain.handle('devcode:getVersion', () => {
    try {
      // First try to read from the userData directory where updates might store it
      const userDevcodeFile = path.join(app.getPath('userData'), '.devcode')
      if (fs.existsSync(userDevcodeFile)) {
        const content = JSON.parse(fs.readFileSync(userDevcodeFile, 'utf8'))
        return content.version
      }
      
      // Fallback to the bundled one
      const devcodeFile = isDev ? path.join(__dirname, '..', '.devcode') : path.join(process.resourcesPath, 'app.asar', '.devcode')
      const content = JSON.parse(fs.readFileSync(devcodeFile, 'utf8'))
      return content.version
    } catch {
      return app.getVersion()
    }
  })

  ipcMain.handle('devcode:downloadAndInstall', async (event, url, version) => {
    const os = require('os')
    const tempDir = path.join(os.homedir(), '.devcode')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    const installerPath = path.join(tempDir, 'devcode_update_installer.exe')

    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Unexpected response: ${response.statusText}`)
      
      const fileStream = fs.createWriteStream(installerPath)
      const { Readable } = require('stream')
      const { finished } = require('stream/promises')
      
      await finished(Readable.fromWeb(response.body).pipe(fileStream))
      
      // Update the local version file to reflect the new version
      if (version) {
        const userDevcodeFile = path.join(app.getPath('userData'), '.devcode')
        fs.writeFileSync(userDevcodeFile, JSON.stringify({ version }, null, 2))
      }
      
      // Run the installer detached
      const child = spawn(installerPath, ['/S', '/force'], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()

      // Quit app to allow installation
      app.quit()
      return true
    } catch (e) {
      console.error('Failed to download update:', e)
      throw e
    }
  })

  await createWindow()

  if (!isDev) {
    const serverPath = path.join(process.resourcesPath, 'app.asar', 'dist-server', 'index.cjs')
    try {
      serverProcess = spawn(process.execPath, [serverPath], {
        env: { ...process.env, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const logPath = path.join(app.getPath('userData'), 'server.log')
      fs.writeFileSync(logPath, 'Starting server at ' + serverPath + '\n')
      
      const isDevMode = process.argv.includes('-dev') || process.argv.includes('--dev')
      let devLogWin = null
      if (isDevMode) {
        devLogWin = new BrowserWindow({
          width: 800,
          height: 600,
          title: 'DevCode Backend Logs',
          backgroundColor: '#000000',
          autoHideMenuBar: true
        })
        devLogWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#000;color:#0f0;font-family:Consolas,monospace;white-space:pre-wrap;font-size:12px;" id="b"></body>'))
      }

      function writeLog(prefix, data) {
        const text = data.toString()
        fs.appendFileSync(logPath, prefix + text)
        if (devLogWin && !devLogWin.isDestroyed()) {
          const safeText = JSON.stringify(prefix + text)
          devLogWin.webContents.executeJavaScript(`document.getElementById('b').textContent += ${safeText}; window.scrollTo(0, document.body.scrollHeight);`).catch(()=>{})
        }
      }

      serverProcess.stdout.on('data', data => writeLog('[STDOUT] ', data))
      serverProcess.stderr.on('data', data => writeLog('[STDERR] ', data))
      serverProcess.on('close', code => writeLog('[CLOSE] ', `Server exited with code ${code}\n`))
      serverProcess.on('error', err => writeLog('[ERROR] ', err.message + '\n'))
    } catch (err) {
      fs.writeFileSync(path.join(app.getPath('userData'), 'server.log'), '[ERROR] ' + err.stack + '\n')
    }
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill()
  }
  if (process.platform !== 'darwin') app.quit()
})
