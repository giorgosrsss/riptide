/* global riptide, icon, hydrateIcons */
const $ = s => document.querySelector(s)

const state = {
  torrents: [],
  filter: 'all',
  query: '',
  selected: null,
  history: [], // [{d,u}]
  settings: null,
  lastClip: ''
}

const FILTER_TITLES = { all: 'All transfers', active: 'Downloading', seeding: 'Seeding', done: 'Completed', stopped: 'Paused' }

// ---------- formatting ----------
function bytes (n) {
  if (!n || n < 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`
}
const speed = n => `${bytes(n)}/s`
function eta (ms) {
  if (!isFinite(ms) || ms <= 0) return '∞'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
const pct = p => `${(p * 100).toFixed(p >= 1 || p === 0 ? 0 : 1)}%`
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const STATUS_LABEL = { downloading: 'Downloading', seeding: 'Seeding', metadata: 'Finding peers', stopped: 'Paused', done: 'Completed', error: 'Error' }

function matchesFilter (t) {
  switch (state.filter) {
    case 'active': return t.status === 'downloading' || t.status === 'metadata'
    case 'seeding': return t.status === 'seeding'
    case 'done': return t.progress >= 1 || !!t.completedAt
    case 'stopped': return t.status === 'stopped'
    default: return true
  }
}

// ---------- toasts ----------
function toast (text, kind = 'info') {
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.innerHTML = `${icon(kind === 'success' ? 'check' : kind === 'error' ? 'alert' : 'magnet').replace('<svg', '<svg class="ic" style="width:16px;height:16px"')}<span>${esc(text)}</span>`
  $('#toasts').appendChild(el)
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300) }, 3600)
}

// ---------- adding ----------
async function addTorrent (id) {
  if (!id || !id.trim()) return
  const r = await riptide.add(id.trim())
  if (!r.ok) return toast(r.error || 'Could not add that link', 'error')
  toast(r.duplicate ? 'Already in your list' : 'Added — connecting to peers', r.duplicate ? 'info' : 'success')
  state.selected = r.infoHash
  openDrawer(true)
}

$('#addbar').addEventListener('submit', e => {
  e.preventDefault()
  const v = $('#magnet').value
  $('#magnet').value = ''
  addTorrent(v)
})
$('#magnet').addEventListener('paste', e => {
  const text = (e.clipboardData || window.clipboardData).getData('text')
  if (/^magnet:\?/i.test(text.trim())) {
    e.preventDefault()
    $('#magnet').value = ''
    addTorrent(text)
  }
})
$('#open-file').addEventListener('click', async () => {
  const res = await riptide.addFiles()
  for (const r of res) if (!r.ok) toast(r.error, 'error')
  if (res.some(r => r.ok)) toast(`Added ${res.filter(r => r.ok).length} torrent(s)`, 'success')
})

// Global Ctrl+V anywhere outside an input adds a magnet straight away
document.addEventListener('keydown', async e => {
  if (e.key === 'Escape') { closeMenu(); if (state.selected) { state.selected = null; openDrawer(false) } }
  const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)
  if (e.ctrlKey && e.key.toLowerCase() === 'v' && !inField) {
    const text = await riptide.readClipboard()
    if (text) addTorrent(text)
  }
})

// Clipboard sniffing when the window regains focus
async function checkClipboard () {
  const text = ((await riptide.readClipboard()) || '').trim()
  if (!/^magnet:\?/i.test(text) || text === state.lastClip) return
  state.lastClip = text
  const known = state.torrents.some(t => text.toLowerCase().includes(t.infoHash))
  if (known) return
  const dn = /[?&]dn=([^&]+)/.exec(text)
  $('#clip-name').textContent = dn ? decodeURIComponent(dn[1].replace(/\+/g, ' ')) : 'unnamed torrent'
  $('#clip-banner').classList.remove('hidden')
  $('#clip-add').onclick = () => { $('#clip-banner').classList.add('hidden'); addTorrent(text) }
}
$('#clip-dismiss').addEventListener('click', () => $('#clip-banner').classList.add('hidden'))
window.addEventListener('focus', checkClipboard)

// Drag & drop
let dragDepth = 0
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#drop').classList.add('show') })
window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('show') } })
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', async e => {
  e.preventDefault()
  dragDepth = 0
  $('#drop').classList.remove('show')
  const files = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.torrent'))
  for (const f of files) {
    const r = await riptide.addDropped(f)
    if (!r.ok) toast(r.error, 'error')
    else { state.selected = r.infoHash; openDrawer(true) }
  }
  if (files.length) toast(`Added ${files.length} torrent(s)`, 'success')
  else {
    const text = e.dataTransfer.getData('text')
    if (text) addTorrent(text)
  }
})

// ---------- filters & search ----------
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('.filter')
  if (!b) return
  document.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === b))
  state.filter = b.dataset.filter
  $('#view-title').textContent = FILTER_TITLES[state.filter]
  renderList()
})
$('#search').addEventListener('input', e => { state.query = e.target.value.toLowerCase(); renderList() })

// ---------- list rendering (keyed, updated in place) ----------
const rows = new Map()

function rowTemplate (t) {
  const el = document.createElement('div')
  el.className = 'row-t'
  el.dataset.hash = t.infoHash
  el.innerHTML = `
    <div class="row-main">
      <div class="row-top"><span class="pill"></span><span class="row-name"></span></div>
      <div class="bar"><i></i></div>
      <div class="row-meta">
        <span class="size"></span>
        <span class="d">${icon('arrowDown').replace('<svg', '<svg class="ic"')}<b></b></span>
        <span class="u">${icon('arrowUp').replace('<svg', '<svg class="ic"')}<b></b></span>
        <span class="p">${icon('users').replace('<svg', '<svg class="ic"')}<b></b></span>
        <span class="e">${icon('clock').replace('<svg', '<svg class="ic"')}<b></b></span>
        <span class="err"></span>
      </div>
    </div>
    <div class="row-actions">
      <div class="row-pct"></div>
      <button class="icon-btn act-toggle" title="Pause"></button>
      <button class="icon-btn act-folder" title="Show in folder">${icon('folder')}</button>
      <button class="icon-btn act-more" title="More">${icon('more')}</button>
    </div>`
  el.addEventListener('click', e => {
    const hash = t.infoHash
    if (e.target.closest('.act-toggle')) return toggle(hash)
    if (e.target.closest('.act-folder')) return riptide.openFolder(hash)
    if (e.target.closest('.act-more')) return openMenu(e.target.closest('.act-more'), hash)
    state.selected = state.selected === hash ? null : hash
    openDrawer(!!state.selected)
  })
  el.addEventListener('dblclick', () => riptide.openFolder(t.infoHash))
  el.addEventListener('contextmenu', e => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY }, t.infoHash) })
  return el
}

function updateRow (el, t) {
  const pill = el.querySelector('.pill')
  pill.className = `pill ${t.status}`
  pill.textContent = STATUS_LABEL[t.status]
  el.querySelector('.row-name').textContent = t.name
  el.querySelector('.row-name').title = t.name
  const bar = el.querySelector('.bar')
  bar.className = `bar ${t.status}`
  bar.firstElementChild.style.width = `${(t.progress * 100).toFixed(2)}%`
  const active = t.status === 'downloading' || t.status === 'seeding' || t.status === 'metadata'
  el.querySelector('.size').textContent = t.length ? `${bytes(t.length * Math.min(1, t.progress))} of ${bytes(t.length)}` : 'Fetching metadata…'
  el.querySelector('.d').style.display = active ? '' : 'none'
  el.querySelector('.u').style.display = active ? '' : 'none'
  el.querySelector('.p').style.display = active ? '' : 'none'
  el.querySelector('.e').style.display = t.status === 'downloading' ? '' : 'none'
  el.querySelector('.d b').textContent = speed(t.downSpeed)
  el.querySelector('.u b').textContent = speed(t.upSpeed)
  el.querySelector('.p b').textContent = `${t.peers} peer${t.peers === 1 ? '' : 's'}`
  el.querySelector('.e b').textContent = eta(t.eta)
  el.querySelector('.err').textContent = t.error || ''
  el.querySelector('.row-pct').textContent = pct(t.progress)
  const tg = el.querySelector('.act-toggle')
  const stopped = t.status === 'stopped' || t.status === 'done' || t.status === 'error'
  const want = stopped ? 'play' : 'pause'
  if (tg.dataset.icon !== want) { tg.dataset.icon = want; tg.innerHTML = icon(want); tg.title = stopped ? 'Resume' : 'Pause' }
  el.classList.toggle('selected', state.selected === t.infoHash)
}

function renderList () {
  const list = $('#list')
  const visible = state.torrents.filter(t => matchesFilter(t) && (!state.query || t.name.toLowerCase().includes(state.query)))
  const keep = new Set(visible.map(t => t.infoHash))
  for (const [h, el] of rows) if (!keep.has(h)) { el.remove(); rows.delete(h) }
  visible.forEach((t, i) => {
    let el = rows.get(t.infoHash)
    if (!el) { el = rowTemplate(t); rows.set(t.infoHash, el) }
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null)
    updateRow(el, t)
  })
  $('#empty').style.display = state.torrents.length ? 'none' : ''
}

function toggle (hash) {
  const t = state.torrents.find(x => x.infoHash === hash)
  if (!t) return
  if (['stopped', 'done', 'error'].includes(t.status)) riptide.resume(hash)
  else riptide.pause(hash)
}

// ---------- context menu ----------
let menuEl = null
function closeMenu () { if (menuEl) { menuEl.remove(); menuEl = null } }
function openMenu (anchor, hash) {
  closeMenu()
  const t = state.torrents.find(x => x.infoHash === hash)
  if (!t) return
  menuEl = document.createElement('div')
  menuEl.className = 'menu'
  const stopped = ['stopped', 'done', 'error'].includes(t.status)
  menuEl.innerHTML = `
    <button data-a="toggle">${icon(stopped ? 'play' : 'pause').replace('<svg', '<svg class="ic"')}${stopped ? 'Resume' : 'Pause'}</button>
    <button data-a="folder">${icon('folder').replace('<svg', '<svg class="ic"')}Show in folder</button>
    <button data-a="details">${icon('layers').replace('<svg', '<svg class="ic"')}Details &amp; files</button>
    <button data-a="copy">${icon('link').replace('<svg', '<svg class="ic"')}Copy magnet link</button>
    <button data-a="hash">${icon('file').replace('<svg', '<svg class="ic"')}Copy info hash</button>
    <hr/>
    <button data-a="remove" class="danger-item">${icon('trash').replace('<svg', '<svg class="ic"')}Remove…</button>`
  document.body.appendChild(menuEl)
  let x, y
  if (anchor instanceof Element) { const r = anchor.getBoundingClientRect(); x = r.right - menuEl.offsetWidth; y = r.bottom + 6 } else { x = anchor.x; y = anchor.y }
  x = Math.max(8, Math.min(x, innerWidth - menuEl.offsetWidth - 8))
  y = Math.min(y, innerHeight - menuEl.offsetHeight - 8)
  menuEl.style.left = `${x}px`
  menuEl.style.top = `${y}px`
  menuEl.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a
    closeMenu()
    if (a === 'toggle') toggle(hash)
    if (a === 'folder') riptide.openFolder(hash)
    if (a === 'details') { state.selected = hash; openDrawer(true) }
    if (a === 'copy') { riptide.copy(t.magnetURI || `magnet:?xt=urn:btih:${hash}`); toast('Magnet link copied') }
    if (a === 'hash') { riptide.copy(hash); toast('Info hash copied') }
    if (a === 'remove') confirmRemove(hash)
  })
}
document.addEventListener('mousedown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu() })
window.addEventListener('blur', closeMenu)

function confirmRemove (hash) {
  const t = state.torrents.find(x => x.infoHash === hash)
  if (!t) return
  const dlg = $('#confirm')
  $('#confirm-name').textContent = t.name
  $('#confirm-delete').checked = false
  dlg.returnValue = ''
  dlg.showModal()
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return
    await riptide.remove(hash, $('#confirm-delete').checked)
    if (state.selected === hash) { state.selected = null; openDrawer(false) }
    toast($('#confirm-delete').checked ? 'Removed and deleted files' : 'Removed from list')
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Delete' && state.selected && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) confirmRemove(state.selected)
  if (e.key === ' ' && state.selected && document.activeElement === document.body) { e.preventDefault(); toggle(state.selected) }
})

// ---------- drawer ----------
function openDrawer (open) {
  $('#drawer').classList.toggle('open', open)
  $('#drawer').setAttribute('aria-hidden', String(!open))
  lastFilesKey = ''
  renderDrawer()
  renderList()
}
$('#d-close').addEventListener('click', () => { state.selected = null; openDrawer(false) })
$('#d-toggle').addEventListener('click', () => state.selected && toggle(state.selected))
$('#d-folder').addEventListener('click', () => state.selected && riptide.openFolder(state.selected))
$('#d-copy').addEventListener('click', () => {
  const t = state.torrents.find(x => x.infoHash === state.selected)
  if (t) { riptide.copy(t.magnetURI || `magnet:?xt=urn:btih:${t.infoHash}`); toast('Magnet link copied') }
})

let lastFilesKey = ''
function renderDrawer () {
  const t = state.torrents.find(x => x.infoHash === state.selected)
  if (!t) return
  $('#d-status').textContent = STATUS_LABEL[t.status]
  $('#d-status').style.color = { downloading: 'var(--teal)', seeding: '#a79dff', metadata: 'var(--amber)', error: 'var(--red)', done: 'var(--green)' }[t.status] || 'var(--text-2)'
  $('#d-name').textContent = t.name
  $('#d-pct').textContent = pct(t.progress)
  $('#d-eta').textContent = t.status === 'downloading' ? `${eta(t.eta)} left` : STATUS_LABEL[t.status]
  $('#d-ring').style.strokeDashoffset = String(326.7 * (1 - t.progress))
  const stopped = ['stopped', 'done', 'error'].includes(t.status)
  const tg = $('#d-toggle')
  const want = stopped ? 'play' : 'pause'
  if (tg.dataset.state !== want) { tg.dataset.state = want; tg.innerHTML = `${icon(want).replace('<svg', '<svg class="ic"')}${stopped ? 'Resume' : 'Pause'}` }
  const stats = [
    ['Download', speed(t.downSpeed)], ['Upload', speed(t.upSpeed)],
    ['Peers', t.peers], ['Ratio', t.ratio ? t.ratio.toFixed(2) : '0.00'],
    ['Size', t.length ? bytes(t.length) : '—'], ['Downloaded', bytes(t.downloaded || t.length * t.progress)],
    ['Uploaded', bytes(t.uploaded)], ['Added', new Date(t.addedAt).toLocaleDateString()]
  ]
  $('#d-stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${esc(v)}</b></div>`).join('') +
    `<div class="stat" style="grid-column:1/-1"><span>Save path</span><b style="font-size:12px;word-break:break-all;user-select:text">${esc(t.path)}</b></div>`

  const files = t.files || []
  $('#d-filecount').textContent = files.length ? `· ${files.length}` : ''
  const key = state.selected + ':' + files.length + ':' + files.map(f => f.selected ? 1 : 0).join('')
  const box = $('#d-files')
  if (key !== lastFilesKey) {
    lastFilesKey = key
    if (!files.length) {
      box.innerHTML = '<p class="muted" style="font-size:12.5px;margin:0">File list appears once metadata arrives from peers.</p>'
    } else {
      box.innerHTML = files.slice(0, 2000).map(f => `
        <div class="file ${f.selected ? '' : 'off'}" data-i="${f.index}">
          <input type="checkbox" class="cb" ${f.selected ? 'checked' : ''} title="Download this file" />
          <div style="min-width:0">
            <div class="file-name" title="${esc(f.path)}">${esc(f.name)}</div>
            <div class="file-sub"><span class="fs"></span></div>
            <div class="bar"><i></i></div>
          </div>
          <button class="icon-btn" title="Open file">${icon('external')}</button>
        </div>`).join('')
      box.querySelectorAll('.file').forEach(row => {
        const i = Number(row.dataset.i)
        row.querySelector('.cb').addEventListener('change', e => riptide.selectFile(state.selected, i, e.target.checked))
        row.querySelector('.icon-btn').addEventListener('click', () => riptide.openFile(state.selected, i))
      })
    }
  }
  box.querySelectorAll('.file').forEach(row => {
    const f = files[Number(row.dataset.i)]
    if (!f) return
    row.querySelector('.fs').textContent = `${bytes(f.length * f.progress)} / ${bytes(f.length)} · ${pct(f.progress)}`
    row.querySelector('.bar > i').style.width = `${(f.progress * 100).toFixed(1)}%`
  })
}

// ---------- graph ----------
const canvas = $('#graph')
const ctx = canvas.getContext('2d')
function drawGraph () {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth * dpr
  const h = canvas.clientHeight * dpr
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  ctx.clearRect(0, 0, w, h)
  const data = state.history
  const max = Math.max(64 * 1024, ...data.map(p => Math.max(p.d, p.u)))
  $('#g-peak').textContent = `peak ${speed(Math.max(0, ...data.map(p => p.d)))}`
  const N = 120
  const step = w / (N - 1)
  const series = (key, color, fill) => {
    if (data.length < 2) return
    const start = N - data.length
    ctx.beginPath()
    data.forEach((p, i) => {
      const x = (start + i) * step
      const y = h - 4 * dpr - (p[key] / max) * (h - 10 * dpr)
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 2 * dpr
    ctx.lineJoin = 'round'
    ctx.stroke()
    ctx.lineTo((N - 1) * step, h)
    ctx.lineTo(start * step, h)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, fill)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fill()
  }
  series('u', '#7b6cff', 'rgba(123,108,255,.22)')
  series('d', '#3ee6c4', 'rgba(62,230,196,.25)')
}

// ---------- state from main ----------
riptide.on('state', s => {
  state.torrents = s.torrents
  state.history.push({ d: s.downSpeed, u: s.upSpeed })
  if (state.history.length > 120) state.history.shift()
  $('#g-down').textContent = speed(s.downSpeed)
  $('#g-up').textContent = speed(s.upSpeed)
  $('#n-port').textContent = s.port
  $('#n-dht').textContent = s.dhtNodes
  $('#n-peers').textContent = s.torrents.reduce((a, t) => a + t.peers, 0)
  const c = { all: 0, active: 0, seeding: 0, done: 0, stopped: 0 }
  for (const t of s.torrents) {
    c.all++
    if (t.status === 'downloading' || t.status === 'metadata') c.active++
    if (t.status === 'seeding') c.seeding++
    if (t.progress >= 1 || t.completedAt) c.done++
    if (t.status === 'stopped') c.stopped++
  }
  for (const k in c) $(`#c-${k}`).textContent = c[k]
  if (state.selected && !s.torrents.some(t => t.infoHash === state.selected)) { state.selected = null; openDrawer(false) }
  const active = s.torrents.filter(t => t.status === 'downloading')
  document.title = active.length ? `${speed(s.downSpeed)} ↓ · Riptide` : 'Riptide'
  renderList()
  renderDrawer()
  drawGraph()
})
riptide.on('toast', t => toast(t.text, t.kind))

// ---------- settings ----------
$('#open-settings').addEventListener('click', async () => {
  const s = await riptide.settings()
  state.settings = s
  $('#s-path').value = s.downloadPath
  $('#s-down').value = s.downloadLimit
  $('#s-up').value = s.uploadLimit
  $('#s-conns').value = s.maxConns
  $('#s-strategy').value = s.strategy
  $('#s-trackers').checked = s.boostTrackers
  $('#s-seed').checked = s.seedAfterDone
  $('#s-notify').checked = s.notify
  $('#s-port').textContent = s.port
  await refreshDefaultBtn()
  $('#settings').showModal()
})
async function refreshDefaultBtn () {
  const isDef = await riptide.isMagnetDefault()
  const b = $('#s-default')
  b.disabled = isDef
  b.textContent = isDef ? 'Default ✓' : 'Make default'
}
$('#s-default').addEventListener('click', async () => { await riptide.makeMagnetDefault(); refreshDefaultBtn() })
$('#s-browse').addEventListener('click', async () => {
  const p = await riptide.chooseFolder()
  if (p) $('#s-path').value = p
})
$('#settings').addEventListener('close', async () => {
  if ($('#settings').returnValue !== 'save') return
  await riptide.updateSettings({
    downloadPath: $('#s-path').value,
    downloadLimit: Math.max(0, Number($('#s-down').value) || 0),
    uploadLimit: Math.max(0, Number($('#s-up').value) || 0),
    maxConns: Math.min(1000, Math.max(10, Number($('#s-conns').value) || 200)),
    strategy: $('#s-strategy').value,
    boostTrackers: $('#s-trackers').checked,
    seedAfterDone: $('#s-seed').checked,
    notify: $('#s-notify').checked
  })
  toast('Settings saved', 'success')
})

hydrateIcons()
renderList()
checkClipboard()
