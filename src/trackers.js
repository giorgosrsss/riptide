// Curated public trackers appended to every torrent for faster peer discovery.
// Refreshed at runtime from github.com/ngosang/trackerslist (cached for 24h).
const fs = require('fs')
const path = require('path')

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker.corpscorp.online:80/announce',
  'udp://tracker.ducks.party:1984/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://tracker.nyaa.vc:6969/announce',
  'http://tracker.dler.org:6969/announce',
  'udp://tracker2.dler.org:80/announce',
  'http://tracker.dler.com:6969/announce',
  'udp://retracker01-msk-virt.corbina.net:80/announce',
  'udp://tracker.gmi.gd:6969/announce',
  'udp://explodie.org:6969/announce',
  'http://tracker.renfei.net:8080/announce'
]

const LIST_URL = 'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt'

async function refreshTrackers (dataDir) {
  const cache = path.join(dataDir, 'trackers.txt')
  let text = null
  try {
    const st = fs.statSync(cache)
    if (Date.now() - st.mtimeMs < 24 * 3600 * 1000) text = fs.readFileSync(cache, 'utf8')
  } catch {}
  if (!text) {
    try {
      const res = await fetch(LIST_URL, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        text = await res.text()
        fs.writeFileSync(cache, text)
      }
    } catch {}
  }
  if (!text) return TRACKERS.length
  const fresh = text.split(/\r?\n/).map(s => s.trim()).filter(s => /^(udp|https?|wss?):\/\//.test(s))
  for (const t of fresh) if (!TRACKERS.includes(t)) TRACKERS.push(t)
  return TRACKERS.length
}

module.exports = { TRACKERS, refreshTrackers }
