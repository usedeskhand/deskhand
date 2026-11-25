// Deskhand's JSON API and the hourly loop. Public reads need nothing; anything that creates or changes needs the wallet session.
import fs from 'node:fs'
import path from 'node:path'
import { nonce, verify, cookie, logout, who } from './auth.mjs'
import { create, setStatus, tick, board, mine, detail, activity, history, marketsView, stats, simulate, approvals, skip, settle } from './agents.mjs'
import { list, get, publish, newVersion, edit, install, mineListings, sales } from './market.mjs'
import { seedHouse } from './house.mjs'
import { clean } from './engine.mjs'
import { read, EXAMPLES } from './brief.mjs'
import { backfill, readHour, hourNow, series, latestHour, scrub } from './prices.mjs'
import { route } from './chain.mjs'
import { BY_SYMBOL, MARKETS, USDG, CHAIN_ID } from './markets.mjs'
import { kv, DATA } from './db.mjs'

const log = (...a) => console.log(new Date().toISOString(), ...a)

// ---- the hourly loop: two minutes past each hour, read the pools, then let every agent decide ----
async function hourly() {
  const h = hourNow()
  try { const p = await readHour(h); log('read hour', h, Object.keys(p).length, 'markets') } catch (e) { log('read failed', e.message) }
  try { log('tick', tick(latestHour()), 'agent-hours') } catch (e) { log('tick failed', e.message) }
}
function schedule() { const ms = 3600e3 - (Date.now() % 3600e3) + 120e3; setTimeout(async () => { await hourly(); schedule() }, ms) }
;(async () => {
  if (process.env.NO_LOOP) return
  await readHour(hourNow()).catch((e) => log('read', e.message))
  await backfill((m) => log(m)).catch((e) => log('backfill', e.message))
  scrub(log)
  try { log('house agents seeded', seedHouse()); log('tick', tick(latestHour())) } catch (e) { log('seed', e.message) }
  schedule()
})()

// the token, once it exists: written by set-ca.sh into the data folder, read by the site
const launch = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'launch.json'), 'utf8')) } catch { return {} } }
// a small per-address brake on the endpoints that cost work
const hits = new Map()
const slow = (req, n = 40) => { const k = (req.headers['fly-client-ip'] || req.socket.remoteAddress || '') + Math.floor(Date.now() / 60e3); const c = (hits.get(k) || 0) + 1; hits.set(k, c); if (hits.size > 5000) hits.clear(); return c > n }

export async function api(req, res, url, { json, bad, body }) {
  const p = url.pathname, me = who(req), M = req.method
  try {
    if (p === '/api/stats') return json(res, 200, { ...stats(), lastRead: kv.get('lastRead', null), launch: launch() })
    if (p === '/api/config') return json(res, 200, { chainId: CHAIN_ID, usdg: USDG, examples: EXAMPLES, launch: launch(), tokens: Object.fromEntries(MARKETS.map((m) => [m.symbol, { address: m.address, decimals: m.decimals }])) })
    if (p === '/api/markets') return json(res, 200, marketsView())
    if (p === '/api/board') return json(res, 200, board())
    if (p === '/api/activity') return json(res, 200, activity(Math.min(100, +url.searchParams.get('limit') || 40)))
    if (p === '/api/listings' && M === 'GET') return json(res, 200, list())
    let m
    if ((m = /^\/api\/listings\/([a-f0-9]{10})$/.exec(p)) && M === 'GET') return json(res, 200, get(m[1], me?.addr))
    if ((m = /^\/api\/agents\/([a-f0-9]{10})$/.exec(p)) && M === 'GET') { const d = detail(m[1]); const own = me && me.addr === d.owner; delete d.owner; if (!own) delete d.config; return json(res, 200, { ...d, mine: !!own }) }
    if ((m = /^\/api\/markets\/([A-Z]{2,6})$/.exec(p))) {
      const k = m[1]; if (!BY_SYMBOL[k]) return bad(res, 'Unknown market.', 404)
      const h = latestHour(), s = series(k, h - 720, h)
      return json(res, 200, { ...BY_SYMBOL[k], closes: s.map((c, i) => [h - 720 + i, c]) })
    }
    // the builder: a brief becomes a draft, a draft is simulated on the last 30 days of real prices
    if (p === '/api/draft' && M === 'POST') {
      if (slow(req)) return bad(res, 'Slow down a little, then try again.', 429)
      const b = await body(req), r = read(b.brief); if (!r.config) return json(res, 200, { error: r.error, notes: r.notes })
      const cfg = clean({ ...r.config, ...(b.edits || {}) }, BY_SYMBOL)
      return json(res, 200, { config: cfg, approve: !!r.config.approve, notes: r.notes, brief: r.brief, sim: simulate(cfg) })
    }
    if (p === '/api/simulate' && M === 'POST') { if (slow(req)) return bad(res, 'Slow down a little, then try again.', 429); const b = await body(req), cfg = clean(b.config || b, BY_SYMBOL); return json(res, 200, { config: cfg, sim: simulate(cfg) }) }
    if (p === '/api/route') {
      if (slow(req, 20)) return bad(res, 'Slow down a little, then try again.', 429)
      const k = url.searchParams.get('symbol'), side = url.searchParams.get('side') === 'sell' ? 'sell' : 'buy', amt = +url.searchParams.get('amount')
      if (!BY_SYMBOL[k] || !(amt > 0) || amt > 1e7) return bad(res, 'Give a market and an amount.')
      return json(res, 200, await route(k, side, amt))
    }

    // session
    if (p === '/api/auth/nonce' && M === 'POST') { const b = await body(req); return json(res, 200, { message: nonce(b.address) }) }
    if (p === '/api/auth/verify' && M === 'POST') {
      const b = await body(req), t = await verify(b.address, b.signature)
      res.setHeader('set-cookie', cookie(t, (req.headers['x-forwarded-proto'] || '') === 'https')); return json(res, 200, { ok: true })
    }
    if (p === '/api/auth/logout' && M === 'POST') { if (me) logout(me.token); res.setHeader('set-cookie', cookie('', true)); return json(res, 200, { ok: true }) }
    if (p === '/api/me') return json(res, 200, me ? { address: me.addr, agents: mine(me.addr), approvals: approvals(me.addr), listings: mineListings(me.addr), sales: sales(me.addr), history: history(me.addr) }
      : { address: null, agents: [], approvals: [], listings: [], sales: [], history: [] })

    if (!me) return bad(res, 'Connect your wallet first.', 401)
    if (M !== 'POST') return bad(res, 'Unknown endpoint.', 404)
    const b = await body(req)
    if (p === '/api/agents') return json(res, 200, { id: create(me.addr, b) })
    if ((m = /^\/api\/agents\/([a-f0-9]{10})\/(pause|resume|stop)$/.exec(p))) { setStatus(me.addr, m[1], { pause: 'paused', resume: 'live', stop: 'stopped' }[m[2]]); return json(res, 200, { ok: true }) }
    if ((m = /^\/api\/approvals\/([a-f0-9]{12})\/skip$/.exec(p))) { skip(me.addr, m[1]); return json(res, 200, { ok: true }) }
    if ((m = /^\/api\/approvals\/([a-f0-9]{12})\/settle$/.exec(p))) return json(res, 200, await settle(me.addr, m[1], String(b.tx || '')))
    if (p === '/api/listings') return json(res, 200, { id: publish(me.addr, b) })
    if ((m = /^\/api\/listings\/([a-f0-9]{10})\/versions$/.exec(p))) return json(res, 200, { version: newVersion(me.addr, m[1], b) })
    if ((m = /^\/api\/listings\/([a-f0-9]{10})\/edit$/.exec(p))) { edit(me.addr, m[1], b); return json(res, 200, { ok: true }) }
    if ((m = /^\/api\/listings\/([a-f0-9]{10})\/install$/.exec(p))) return json(res, 200, await install(me.addr, m[1], b))
    return bad(res, 'Unknown endpoint.', 404)
  } catch (e) { if (e.code >= 400 && e.code < 600) return bad(res, e.message, e.code); throw e }
}

// values the server writes into pages as they are served: live counts and the latest lines of the decision log
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const money = (v) => '$' + (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : v.toFixed(2))
let tk = { t: 0, v: {} }
export function tokens() {
  if (Date.now() - tk.t < 30e3) return tk.v
  const s = stats(), v = { agents: s.agents, decisions: s.decisions, markets: s.markets, listings: s.listings, trades: s.trades }
  const rows = activity(60), trades = rows.filter((r) => r.action !== 'hold'), seen = new Set(), pick = []
  for (const r of [...trades, ...rows]) { const k = r.agent; if (seen.has(k)) continue; seen.add(k); pick.push(r); if (pick.length === 4) break }
  pick.forEach((r, i) => { const when = new Date(r.hour * 3600e3).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC'
    Object.assign(v, { [`log${i}.agent`]: r.agent, [`log${i}.symbol`]: r.symbol, [`log${i}.action`]: r.action, [`log${i}.verb`]: { buy: 'Bought', sell: 'Sold', hold: 'Waited', ask: 'Asked' }[r.action],
      [`log${i}.reason`]: esc(r.reason), [`log${i}.name`]: esc(r.name), [`log${i}.what`]: `${r.symbol} at ${money(r.price)}${r.usd ? `, ${money(r.usd)}` : ''}`, [`log${i}.when`]: when }) })
  tk = { t: Date.now(), v }; return v
}
