const { app, BrowserWindow, ipcMain, dialog, shell, Notification, clipboard, nativeTheme, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const { Engine } = require('./engine')
const { refreshTrackers } = require('./trackers')

app.setAppUserModelId('com.giorgosrsss.riptide')
if (process.env.RIPTIDE_DATA) app.setPath('userData', process.env.RIPTIDE_DATA)

// Single instance: magnet links / .torrent files opened later get forwarded here.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win = null
let engine = null
const pendingOpens = []

function torrentArgs (argv) {
  return argv.slice(1).filter(a => /^magnet:/i.test(a) || (/\.torrent$/i.test(a) && fs.existsSync(a)))
}

async function openExternal (ids) {
  for (const id of ids) {
    if (!engine) { pendingOpens.push(id); continue }
    try {
      await engine.add(id)
    } catch (err) {
      send('toast', { kind: 'error', text: err.message })
    }
  }
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
}

app.on('second-instance', (_e, argv) => openExternal(torrentArgs(argv)))
app.on('open-url', (e, url) => { e.preventDefault(); openExternal([url]) })

function send (channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow () {
  nativeTheme.themeSource = 'dark'
  win = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#0b0d12',
    title: 'Riptide',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d12', symbolColor: '#9aa3b2', height: 44 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  Menu.setApplicationMenu(null)
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
}

app.whenReady().then(async () => {
  // Claim magnet: links only when no other app has them; Settings has an explicit button otherwise.
  if (!process.env.RIPTIDE_SMOKE && !app.getApplicationNameForProtocol('magnet:')) registerMagnetHandler()

  const dataDir = app.getPath('userData')
  await refreshTrackers(dataDir).catch(() => {})
  engine = new Engine(dataDir, path.join(app.getPath('downloads'), 'Riptide'))
  fs.mkdirSync(engine.settings.downloadPath, { recursive: true })

  engine.on('completed', ({ name, path: dir }) => {
    send('toast', { kind: 'success', text: `Finished: ${name}` })
    if (engine.settings.notify && Notification.isSupported()) {
      const n = new Notification({ title: 'Download complete', body: name, silent: false })
      n.on('click', () => shell.openPath(dir))
      n.show()
    }
  })
  engine.on('log', msg => send('log', msg))

  registerIpc()
  createWindow()
  await engine.start()

  openExternal([...pendingOpens.splice(0), ...torrentArgs(process.argv)])

  setInterval(() => send('state', engine.snapshot()), 500)

  if (process.env.RIPTIDE_SMOKE) runSmoke(process.env.RIPTIDE_SMOKE)
})

// Dev-only: RIPTIDE_SMOKE=<magnet> adds it, logs speed, saves a screenshot, quits.
async function runSmoke (magnet) {
  const out = process.env.RIPTIDE_SMOKE_OUT || app.getPath('temp')
  engine.updateSettings({ downloadPath: path.join(out, 'downloads') })
  win.setAlwaysOnTop(true)
  win.focus()
  const r = await engine.add(magnet)
  setTimeout(() => win.webContents.executeJavaScript(process.env.RIPTIDE_SMOKE_JS || "document.querySelector('.row-t')?.click()"), 4000)
  let peak = 0
  const timer = setInterval(() => {
    const s = engine.snapshot()
    const t = s.torrents.find(x => x.infoHash === r.infoHash)
    peak = Math.max(peak, s.downSpeed)
    console.log(`[smoke] ${t.status} ${(t.progress * 100).toFixed(1)}% down=${(s.downSpeed / 1048576).toFixed(2)}MB/s peers=${t.peers} dht=${s.dhtNodes}`)
  }, 2000)
  setTimeout(async () => {
    clearInterval(timer)
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(out, 'riptide-smoke.png'), img.toPNG())
    console.log(`[smoke] peak=${(peak / 1048576).toFixed(2)}MB/s`)
    app.quit()
  }, Number(process.env.RIPTIDE_SMOKE_MS || 40000))
}

function registerMagnetHandler () {
  if (process.defaultApp) return app.setAsDefaultProtocolClient('magnet', process.execPath, [path.resolve(process.argv[1])])
  return app.setAsDefaultProtocolClient('magnet')
}

function registerIpc () {
  ipcMain.handle('magnet-default', () => app.isDefaultProtocolClient('magnet', process.defaultApp ? process.execPath : undefined, process.defaultApp ? [path.resolve(process.argv[1])] : undefined))
  ipcMain.handle('make-magnet-default', () => registerMagnetHandler())
  ipcMain.handle('add', async (_e, id) => {
    try {
      const r = await engine.add(id)
      return { ok: true, ...r }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  ipcMain.handle('add-files', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Open torrent files',
      filters: [{ name: 'Torrent files', extensions: ['torrent'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (r.canceled) return []
    const out = []
    for (const f of r.filePaths) {
      try { out.push({ ok: true, ...(await engine.add(f)) }) } catch (err) { out.push({ ok: false, error: err.message }) }
    }
    return out
  })
  ipcMain.handle('pause', (_e, h) => engine.pause(h))
  ipcMain.handle('resume', (_e, h) => engine.resume(h))
  ipcMain.handle('remove', (_e, h, del) => engine.remove(h, del))
  ipcMain.handle('select-file', (_e, h, i, sel) => engine.setFileSelected(h, i, sel))
  ipcMain.handle('settings', () => engine.settings)
  ipcMain.handle('update-settings', (_e, patch) => engine.updateSettings(patch))
  ipcMain.handle('choose-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: engine.settings.downloadPath })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('open-folder', (_e, h) => {
    const t = engine.snapshot().torrents.find(x => x.infoHash === h)
    if (!t) return
    const first = t.files && t.files[0] ? path.join(t.path, t.files[0].path) : null
    if (first && fs.existsSync(first)) shell.showItemInFolder(first)
    else shell.openPath(t.path)
  })
  ipcMain.handle('open-file', (_e, h, i) => {
    const t = engine.snapshot().torrents.find(x => x.infoHash === h)
    if (t && t.files[i]) shell.openPath(path.join(t.path, t.files[i].path))
  })
  ipcMain.handle('copy', (_e, text) => clipboard.writeText(text))
  ipcMain.handle('read-clipboard', () => clipboard.readText())
}

let quitting = false
app.on('before-quit', async e => {
  if (quitting || !engine) return
  e.preventDefault()
  quitting = true
  await engine.destroy()
  app.quit()
})

app.on('window-all-closed', () => app.quit())
