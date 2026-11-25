// Static site (template mirror or built site) + JSON API (/api/*) when lib/api.mjs exists.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.dirname(new URL(import.meta.url).pathname)
const SITE = process.env.SITE_DIR || path.join(ROOT, 'public')
const PORT = +process.env.PORT || 5570
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.txt': 'text/plain' }

const json = (res, code, v) => { res.writeHead(code, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }); res.end(JSON.stringify(v)) }
const bad = (res, msg, code = 400) => json(res, code, { error: msg })
async function body(req, max = 1e5) { let s = ''; for await (const c of req) { s += c; if (s.length > max) break } try { return JSON.parse(s || '{}') } catch { return {} } }

let api = async (req, res) => bad(res, 'Unknown endpoint.', 404), tokens = () => ({}), mcp = null
try { ({ api, tokens } = await import('./lib/api.mjs')); mcp = await import('./lib/mcp.mjs') } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e }

// the app is one page for all of these; the template pages we do not use go to the page that does the job
const APP = [[/^\/app\/?$/, 'Builder'], [/^\/market\/?$/, 'Marketplace'], [/^\/market\/[a-f0-9]{10}\/?$/, 'Listing'], [/^\/agents\/[a-f0-9]{10}\/?$/, 'Agent'], [/^\/board\/?$/, 'Leaderboard'],
  [/^\/markets\/?$/, 'Markets'], [/^\/markets\/[A-Z]{2,6}\/?$/, 'Market'], [/^\/desk\/?$/, 'My desk']]
const MOVED = { '/home': '/', '/about': '/how-it-works', '/contact': '/how-it-works', '/docs': '/how-it-works', '/marketplace': '/market', '/leaderboard': '/board', '/builder': '/app', '/legal': '/legal/terms', '/terms': '/legal/terms', '/privacy': '/legal/privacy', '/risk': '/legal/risk' }

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname), title = null
  for (const [re, t] of APP) if (re.test(rel)) { title = t; rel = '/app.html' }
  if (rel === '/') rel = '/index.html'
  let f = path.join(SITE, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!f.startsWith(SITE)) { res.writeHead(403); return res.end() }
  if (fs.existsSync(f + '.html') && (!fs.existsSync(f) || fs.statSync(f).isDirectory())) f += '.html'
  else if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html')
  let code = 200
  if (!fs.existsSync(f)) { code = 404; f = path.join(SITE, '404.html'); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('Not found') } }
  const ext = path.extname(f).toLowerCase()
  res.writeHead(code, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': /^\.(html|m?js|json|css)$/.test(ext) ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', ...(ext === '.html' ? { 'x-frame-options': 'DENY' } : {}) })
  if (ext !== '.html') return fs.createReadStream(f).pipe(res)
  const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`, t = { ...tokens(), title: title || '', path: url.pathname }
  res.end(fs.readFileSync(f, 'utf8').replaceAll('__ORIGIN__', origin).replace(/\{\{([a-z0-9.]+)\}\}/g, (m, k) => (k in t ? t[k] : '')))
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const mv = MOVED[url.pathname.replace(/\/$/, '')]; if (mv) { res.writeHead(302, { location: mv }); return res.end() }
  try {
    if (url.pathname === '/mcp' && mcp) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id, authorization', 'access-control-allow-methods': 'POST, GET, OPTIONS' }
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
      if (req.method === 'GET' && /text\/html/.test(req.headers.accept || '')) return serveStatic(req, res, url) // a person opening the address gets the docs page
      if (req.method === 'GET') { res.writeHead(405, { ...cors, allow: 'POST' }); return res.end() } // no server-initiated stream
      if (req.method !== 'POST') { res.writeHead(405, cors); return res.end() }
      const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`, msg = await body(req, 2e5)
      const out = Array.isArray(msg) ? msg.map((m) => mcp.handle(m, { origin })).filter(Boolean) : mcp.handle(msg, { origin })
      if (out == null || (Array.isArray(out) && !out.length)) { res.writeHead(202, cors); return res.end() }
      res.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify(out))
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url, { json, bad, body })
    return serveStatic(req, res, url)
  } catch (e) { console.error(e); if (!res.headersSent) bad(res, 'Something went wrong. Try again.', 500) }
}).listen(PORT, () => console.log('site on', PORT))
