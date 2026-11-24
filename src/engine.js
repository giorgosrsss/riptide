// Torrent engine: wraps WebTorrent, tuned for throughput, with session persistence.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const EventEmitter = require('events')
const { TRACKERS } = require('./trackers')

const DEFAULT_SETTINGS = {
  downloadPath: null, // filled in by main
  maxConns: 200, // peer connections per torrent
  downloadLimit: 0, // KB/s, 0 = unlimited
  uploadLimit: 0, // KB/s, 0 = unlimited
  port: 0, // 0 = picked once and remembered
  boostTrackers: true, // append a curated public tracker list to every torrent
  strategy: 'rarest', // 'rarest' (fastest overall) | 'sequential' (stream-friendly)
  seedAfterDone: true,
  notify: true
}

class Engine extends EventEmitter {
  constructor (dataDir, defaultDownloadPath) {
    super()
    this.dataDir = dataDir
    this.torrentDir = path.join(dataDir, 'torrents')
    this.sessionFile = path.join(dataDir, 'session.json')
    this.settingsFile = path.join(dataDir, 'settings.json')
    fs.mkdirSync(this.torrentDir, { recursive: true })

    this.settings = { ...DEFAULT_SETTINGS, downloadPath: defaultDownloadPath, ...readJson(this.settingsFile, {}) }
    if (!this.settings.port) this.settings.port = 20000 + crypto.randomInt(30000)
    this._saveSettings()

    this.entries = new Map() // infoHash -> entry (persistent record)
    this.client = null
    this.totalDown = 0
    this.totalUp = 0
  }

  async start () {
    const { default: WebTorrent } = await import('webtorrent')
    this.WebTorrent = WebTorrent
    this._createClient()
    const saved = readJson(this.sessionFile, [])
    for (const e of saved) {
      this.entries.set(e.infoHash, { ...e, error: null })
      if (!e.stopped) this._attach(e.infoHash)
    }
    this._saveSession()
  }

  _createClient () {
    const s = this.settings
    this.client = new this.WebTorrent({
      maxConns: s.maxConns,
      torrentPort: s.port, // TCP + uTP (UDP)
      dhtPort: s.port + 1, // DHT needs its own UDP socket
      dht: true,
      lsd: true,
      utp: true,
      utPex: true,
      natUpnp: true,
      natPmp: true,
      webSeeds: true,
      downloadLimit: s.downloadLimit > 0 ? s.downloadLimit * 1024 : -1,
      uploadLimit: s.uploadLimit > 0 ? s.uploadLimit * 1024 : -1
    })
    const client = this.client
    client.on('error', err => {
      console.error('[engine] client error', err.message)
      this.emit('log', `Client error: ${err.message}`)
      // Port taken by another app: hop to a fresh port and bring every active torrent back.
      if (err.code === 'EADDRINUSE' && this.client === client && (this._portRetries = (this._portRetries || 0) + 1) <= 5) {
        this.settings.port = 20000 + crypto.randomInt(30000)
        this._saveSettings()
        setTimeout(() => {
          this._createClient()
          for (const e of this.entries.values()) if (!e.stopped) this._attach(e.infoHash)
        }, 200)
      }
    })
  }

  // ---------- public API ----------

  async add (torrentId) {
    let id = torrentId
    if (typeof id === 'string') {
      id = id.trim()
      if (/^[a-f0-9]{40}$/i.test(id) || /^[a-z2-7]{32}$/i.test(id)) id = `magnet:?xt=urn:btih:${id}`
      if (!id.startsWith('magnet:') && fs.existsSync(id)) id = fs.readFileSync(id)
    }
    const parsed = await this._parse(id)
    const infoHash = parsed.infoHash
    if (this.entries.has(infoHash)) {
      const e = this.entries.get(infoHash)
      if (e.stopped) this.resume(infoHash)
      return { infoHash, duplicate: true }
    }
    const entry = {
      infoHash,
      name: parsed.name || parsed.dn || infoHash,
      magnetURI: typeof id === 'string' ? id : null,
      path: this.settings.downloadPath,
      addedAt: Date.now(),
      completedAt: null,
      stopped: false,
      deselected: [],
      length: parsed.length || 0,
      error: null
    }
    if (Buffer.isBuffer(id)) fs.writeFileSync(this._torrentFile(infoHash), id)
    this.entries.set(infoHash, entry)
    this._attach(infoHash)
    this._saveSession()
    return { infoHash, duplicate: false }
  }

  pause (infoHash) {
    const e = this.entries.get(infoHash)
    if (!e || e.stopped) return
    e.stopped = true
    this._detach(infoHash)
    this._saveSession()
  }

  resume (infoHash) {
    const e = this.entries.get(infoHash)
    if (!e || !e.stopped) return
    e.stopped = false
    e.error = null
    this._attach(infoHash)
    this._saveSession()
  }

  async remove (infoHash, deleteFiles) {
    const e = this.entries.get(infoHash)
    if (!e) return
    const t = this._get(infoHash)
    const filePaths = t && t.files ? t.files.map(f => path.join(t.path, f.path)) : []
    const rootName = t && t.files && t.files.length ? t.files[0].path.split(/[\\/]/)[0] : e.name
    await new Promise(resolve => (t ? t.destroy({ destroyStore: false }, () => resolve()) : resolve()))
    this.entries.delete(infoHash)
    try { fs.unlinkSync(this._torrentFile(infoHash)) } catch {}
    if (deleteFiles) {
      for (const p of filePaths) { try { fs.rmSync(p, { force: true }) } catch {} }
      const root = path.join(e.path, rootName)
      try { if (root !== e.path && fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true }) } catch {}
    }
    this._saveSession()
  }

  setFileSelected (infoHash, index, selected) {
    const e = this.entries.get(infoHash)
    if (!e) return
    const set = new Set(e.deselected)
    selected ? set.delete(index) : set.add(index)
    e.deselected = [...set]
    this._saveSession()
    const t = this._get(infoHash)
    if (t && t.ready) this._applySelection(t, e)
  }

  updateSettings (patch) {
    const before = { ...this.settings }
    this.settings = { ...this.settings, ...patch }
    this._saveSettings()
    if (this.client) {
      if (before.downloadLimit !== this.settings.downloadLimit) this.client.throttleDownload(this.settings.downloadLimit > 0 ? this.settings.downloadLimit * 1024 : -1)
      if (before.uploadLimit !== this.settings.uploadLimit) this.client.throttleUpload(this.settings.uploadLimit > 0 ? this.settings.uploadLimit * 1024 : -1)
      if (before.maxConns !== this.settings.maxConns) {
        this.client.maxConns = this.settings.maxConns
        for (const t of this.client.torrents) t.maxConns = this.settings.maxConns
      }
      if (before.strategy !== this.settings.strategy) for (const t of this.client.torrents) t.strategy = this.settings.strategy
    }
    return this.settings
  }

  snapshot () {
    const list = []
    let down = 0
    let up = 0
    for (const e of this.entries.values()) {
      const t = this._get(e.infoHash)
      const item = {
        infoHash: e.infoHash,
        name: (t && t.name) || e.name,
        path: e.path,
        addedAt: e.addedAt,
        completedAt: e.completedAt,
        magnetURI: (t && t.magnetURI) || e.magnetURI,
        error: e.error,
        status: 'stopped',
        progress: e.completedAt ? 1 : (e.progress || 0),
        length: (t && t.length) || e.length || 0,
        downloaded: 0,
        uploaded: 0,
        downSpeed: 0,
        upSpeed: 0,
        peers: 0,
        eta: Infinity,
        ratio: 0,
        files: e.files || []
      }
      if (t) {
        const ready = t.ready
        item.progress = ready ? t.progress : 0
        item.downloaded = t.downloaded
        item.uploaded = t.uploaded
        item.downSpeed = t.downloadSpeed
        item.upSpeed = t.uploadSpeed
        item.peers = t.numPeers
        item.eta = t.timeRemaining
        item.ratio = t.uploaded / Math.max(1, t.length || 1)
        item.status = !ready ? 'metadata' : t.done ? 'seeding' : 'downloading'
        if (ready && t.files) {
          item.files = t.files.map((f, i) => ({
            index: i,
            name: f.name,
            path: f.path,
            length: f.length,
            progress: f.progress,
            selected: !e.deselected.includes(i)
          }))
          e.files = item.files.map(f => ({ ...f, progress: f.progress }))
          e.progress = t.progress
        }
        down += t.downloadSpeed
        up += t.uploadSpeed
      } else if (e.completedAt) {
        item.status = 'done'
      }
      if (e.error) item.status = 'error'
      list.push(item)
    }
    list.sort((a, b) => b.addedAt - a.addedAt)
    return {
      torrents: list,
      downSpeed: down,
      upSpeed: up,
      port: this.settings.port,
      dhtNodes: this.client && this.client.dht ? safe(() => this.client.dht.toJSON().nodes.length, 0) : 0
    }
  }

  destroy () {
    return new Promise(resolve => {
      this._saveSession()
      if (!this.client || this.client.destroyed) return resolve()
      try { this.client.destroy(() => resolve()) } catch { resolve() }
      setTimeout(resolve, 3000)
    })
  }

  // ---------- internals ----------

  _attach (infoHash) {
    const e = this.entries.get(infoHash)
    const file = this._torrentFile(infoHash)
    const source = fs.existsSync(file) ? fs.readFileSync(file) : (e.magnetURI || `magnet:?xt=urn:btih:${infoHash}`)
    const opts = {
      path: e.path,
      maxWebConns: 8,
      strategy: this.settings.strategy,
      storeCacheSlots: 64,
      deselect: e.deselected.length > 0
    }
    if (this.settings.boostTrackers) opts.announce = TRACKERS
    let t
    try {
      t = this.client.add(source, opts)
    } catch (err) {
      e.error = err.message
      return
    }
    t.maxConns = this.settings.maxConns
    t.on('metadata', () => {
      e.name = t.name
      e.length = t.length
      try { fs.writeFileSync(file, t.torrentFile) } catch {}
      this._saveSession()
    })
    t.on('ready', () => this._applySelection(t, e))
    t.on('done', () => {
      if (!e.completedAt) {
        e.completedAt = Date.now()
        this.emit('completed', { infoHash, name: t.name, path: e.path })
      }
      e.progress = 1
      this._saveSession()
      if (!this.settings.seedAfterDone) this.pause(infoHash)
    })
    t.on('error', err => {
      e.error = err.message
      this.emit('log', `${e.name}: ${err.message}`)
      this._saveSession()
    })
  }

  _applySelection (t, e) {
    if (!t.files || !t.pieces) return
    // Rebuild the selection from scratch so deselected files really stop downloading
    t._selections.clear()
    if (e.deselected.length === 0) {
      t.select(0, t.pieces.length - 1, 0)
    } else {
      t.files.forEach((f, i) => { if (!e.deselected.includes(i)) f.select() })
    }
    t._updateSelections()
  }

  _detach (infoHash) {
    const t = this._get(infoHash)
    if (t) t.destroy({ destroyStore: false })
  }

  _get (infoHash) {
    if (!this.client) return null
    return this.client.torrents.find(t => t.infoHash === infoHash) || null
  }

  _torrentFile (infoHash) {
    return path.join(this.torrentDir, `${infoHash}.torrent`)
  }

  async _parse (id) {
    const { default: parseTorrent } = await import('parse-torrent')
    const parsed = await parseTorrent(id)
    if (!parsed || !parsed.infoHash) throw new Error('Not a valid magnet link or torrent file')
    return parsed
  }

  _saveSession () {
    const data = [...this.entries.values()].map(({ error, ...rest }) => rest)
    writeJson(this.sessionFile, data)
  }

  _saveSettings () {
    writeJson(this.settingsFile, this.settings)
  }
}

function readJson (file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson (file, data) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, file)
}

function safe (fn, fallback) {
  try { return fn() } catch { return fallback }
}

module.exports = { Engine, DEFAULT_SETTINGS }
