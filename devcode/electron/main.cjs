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
  activeWatcher = chokidar.watch(root, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true
  })
  
  activeWatcher.on('all', (event, p) => {
    const rel = path.relative(root, p).replace(/\\/g, '/')
    webContents.send('fs:watch:change', { event, path: rel })
  })
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
      const devcodeFile = isDev ? path.join(__dirname, '..', '.devcode') : path.join(process.resourcesPath, 'app.asar', '.devcode')
      const content = JSON.parse(fs.readFileSync(devcodeFile, 'utf8'))
      return content.version
    } catch {
      return app.getVersion()
    }
  })

  ipcMain.handle('devcode:downloadAndInstall', async (event, url) => {
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
    const serverPath = path.join(process.resourcesPath, 'app.asar', 'server', 'index.mjs')
    import('file://' + serverPath).catch(err => {
      fs.writeFileSync(path.join(app.getPath('userData'), 'server.log'), '[ERROR] ' + err.stack + '\n')
    })
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
