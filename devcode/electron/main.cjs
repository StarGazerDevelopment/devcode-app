const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

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

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#ffffff',
    title: 'devcode',
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

  ipcMain.handle('devcode:getVersion', () => app.getVersion())

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
    const serverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'index.mjs')
    const nodePath = path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'node.exe')
    serverProcess = spawn(nodePath, [serverPath], {
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'inherit'
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
