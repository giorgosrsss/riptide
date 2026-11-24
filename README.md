<p align="center">
  <img src="build/icon.png" width="96" alt="Riptide icon" />
</p>

<h1 align="center">Riptide</h1>

<p align="center">A fast, good-looking magnet &amp; torrent downloader for the desktop.</p>

---

Paste a magnet link, drop a `.torrent` file, or click a magnet link in your browser. Riptide finds peers within seconds and downloads at full speed.

## Features

- **Fast peer discovery.** DHT, PEX, local service discovery and a curated public tracker list that refreshes every day, so torrents connect in seconds.
- **Max-throughput networking.** TCP and uTP transports, up to 200 peers per torrent (you can change this), rarest-first piece picking, HTTP web seeds, and UPnP / NAT-PMP port mapping so peers can reach you.
- **Opens magnet links.** Registers as the system `magnet:` handler and opens `.torrent` files. Links you click in a browser go straight into the running app.
- **Clipboard detection.** Copy a magnet link, switch back to Riptide, and it offers to add it. `Ctrl+V` anywhere in the window adds it immediately.
- **Drag and drop** `.torrent` files anywhere in the window.
- **Pick the files you want.** Untick files in the details panel and they stop downloading.
- **Live throughput graph** plus per-torrent speed, peers, ETA, ratio, and per-file progress.
- **Pause / resume / remove**, optionally deleting the downloaded files.
- **Session restore.** Everything picks up where it left off when you reopen the app, and already-downloaded pieces are verified instead of downloaded again.
- **Settings.** Download folder, speed limits, peer cap, piece order (rarest-first or sequential for streaming), tracker boost, seeding, and notifications.
- **Desktop notifications** when a download finishes. Click the notification to open the folder.

## Getting started

```bash
git clone https://github.com/giorgosrsss/riptide.git
cd riptide
npm install
npm start
```

npm 11+ blocks dependency install scripts by default. `package.json` already allow-lists the ones Riptide needs: `utp-native`, `node-datachannel` and `electron-winstaller`.

### Build an installer

```bash
npm run dist     # NSIS installer + portable .exe in dist/
npm run pack     # unpacked app in dist/win-unpacked
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+V` | Add the magnet link on your clipboard |
| `Space` | Pause / resume the selected torrent |
| `Delete` | Remove the selected torrent |
| `Esc` | Close the details panel |

## Tips for maximum speed

- Allow Riptide through Windows Firewall the first time it asks (private networks at least). Incoming connections roughly double the number of peers you can reach.
- If your router has UPnP turned off, forward the port shown in **Settings** (TCP + UDP) to your PC.
- Keep **Boost with public tracker list** on. It helps most with torrents that have few trackers.
- Use **Rarest first** piece order unless you want to watch a video while it downloads.

## Tech

Electron, [WebTorrent](https://github.com/webtorrent/webtorrent) and plain HTML/CSS/JS. No UI framework.

```
src/
  main.js        Electron main process, IPC, magnet protocol handling
  engine.js      WebTorrent wrapper: tuning, persistence, file selection
  trackers.js    public tracker list + daily refresh
  preload.js     safe bridge to the UI
  renderer/      UI (index.html, styles.css, app.js, icons.js)
```

## Legal

Riptide is a general-purpose BitTorrent client. Only download and share content you have the right to.

## License

MIT
