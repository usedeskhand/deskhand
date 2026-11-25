// Agents: creation, the hourly tick, approvals for agents that trade from a wallet, and the public views.
import crypto from 'node:crypto'
import { all, one, run, tx, now } from './db.mjs'
import { plan, apply, mark, step, fresh, clean, replay, readable, permissions, holdValue, FEE, LOOKBACK } from './engine.mjs'
import { series, latestHour } from './prices.mjs'
import { BY_SYMBOL, MARKETS } from './markets.mjs'
import { fillOf } from './chain.mjs'

export const HOUSE = 'deskhand'
const MAX_LIVE = 8, APPROVAL_HOURS = 6
const err = (m, code = 400) => Object.assign(new Error(m), { code })
const parse = (a) => ({ ...a, config: JSON.parse(a.config), state: JSON.parse(a.state) })
const KIND = { rules: 'Rules', dca: 'Scheduled buy', basket: 'Basket' }
export const short = (addr) => (addr === HOUSE ? 'Deskhand' : addr.slice(0, 6) + '…' + addr.slice(-4))
const windowsAt = (cfg, h) => Object.fromEntries(cfg.markets.map((k) => [k, series(k, h - LOOKBACK, h)]))
const lastOf = (w) => w[w.length - 1]

export function create(addr, input, opts = {}) {
  const cfg = clean(input.config || input, BY_SYMBOL), mode = input.mode === 'wallet' ? 'wallet' : 'paper'
  if (!opts.house && one("SELECT COUNT(*) n FROM agents WHERE addr = ? AND status = 'live'", addr).n >= MAX_LIVE) throw err(`You already run ${MAX_LIVE} agents. Pause or stop one to start another.`)
  const h = latestHour(); if (!h) throw err('Prices are still loading. Try again in a minute.', 503)
  const state = fresh(cfg); state.first = Object.fromEntries(cfg.markets.map((k) => [k, series(k, h, h)[0]]))
  if (cfg.markets.some((k) => !state.first[k])) throw err('One of these markets has no price yet.')
  const id = crypto.randomBytes(5).toString('hex')
  tx(() => {
    run('INSERT INTO agents (id, addr, name, brief, config, mode, status, start_hour, state, created, house, listing, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, addr, cfg.name, String(input.brief || '').slice(0, 600), JSON.stringify(cfg), mode, 'live', h - 1, JSON.stringify(state), now(), opts.house ? 1 : 0, opts.listing || null, opts.version || null)
    run('INSERT INTO equity (agent, hour, value, hold) VALUES (?, ?, ?, ?)', id, h - 1, cfg.budget, cfg.budget)
  })
  tick(h, id) // the agent reads the current hour straight away, so its first decision is there when the page opens
  return id
}

export function setStatus(addr, id, status) {
  const a = one('SELECT * FROM agents WHERE id = ?', id)
  if (!a || a.addr !== addr) throw err('That agent is not yours.', 403)
  if (a.status === 'stopped') throw err('This agent is stopped for good.')
  if (status === 'live' && a.status !== 'live' && one("SELECT COUNT(*) n FROM agents WHERE addr = ? AND status = 'live'", addr).n >= MAX_LIVE) throw err(`You already run ${MAX_LIVE} agents. Pause one first.`)
  tx(() => { run('UPDATE agents SET status = ? WHERE id = ?', status, id); if (status !== 'live') run("UPDATE approvals SET status = 'expired', settled = ? WHERE agent = ? AND status = 'pending'", now(), id) })
}

const equityOf = (state, w) => state.cash + Object.entries(state.pos).reduce((s, [k, p]) => s + p.qty * (lastOf(w[k] || []) || p.entry), 0)

// run every live agent on the hours it has not decided yet, up to `hour`
export function tick(hour = latestHour(), only = null) {
  let n = 0
  run("UPDATE approvals SET status = 'expired', settled = ? WHERE status = 'pending' AND hour <= ?", now(), hour - APPROVAL_HOURS)
  for (const raw of only ? all("SELECT * FROM agents WHERE status = 'live' AND id = ?", only) : all("SELECT * FROM agents WHERE status = 'live'")) {
    const a = parse(raw)
    const done = one('SELECT MAX(hour) h FROM equity WHERE agent = ?', a.id).h ?? a.start_hour
    for (let h = done + 1; h <= hour; h++) {
      const w = windowsAt(a.config, h); let decisions
      if (a.mode === 'paper') decisions = step(a.config, a.state, w, h).decisions
      else {
        // a wallet agent never moves anything: a trade becomes a request, and only a confirmed transaction changes its books
        decisions = plan(a.config, a.state, w, h); mark(a.config, a.state, decisions, h)
        for (const d of decisions) if (d.action !== 'hold') {
          d.asked = d.action
          if (h === hour && !one("SELECT 1 x FROM approvals WHERE agent = ? AND symbol = ? AND status = 'pending'", a.id, d.symbol))
            run('INSERT INTO approvals (id, agent, addr, hour, symbol, action, usd, qty, price, reason, status, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              crypto.randomBytes(6).toString('hex'), a.id, a.addr, h, d.symbol, d.action, d.usd, d.qty, d.price, d.reason, 'pending', now())
          d.reason = `Asked for approval to ${d.action} ${d.symbol}. ${d.reason}`; d.action = 'ask'
        }
      }
      const hold = holdValue(a.config, a.state.first, w)
      tx(() => {
        for (const d of decisions) run('INSERT OR REPLACE INTO decisions (agent, hour, symbol, action, price, qty, usd, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', a.id, h, d.symbol, d.action, d.price, d.qty || 0, d.usd || 0, d.reason)
        run('INSERT OR REPLACE INTO equity (agent, hour, value, hold) VALUES (?, ?, ?, ?)', a.id, h, equityOf(a.state, w), hold)
        run('UPDATE agents SET state = ? WHERE id = ?', JSON.stringify(a.state), a.id)
      })
      n++
    }
  }
  return n
}

// ---- approvals ----
export function approvals(addr) {
  const names = Object.fromEntries(all('SELECT id, name FROM agents WHERE addr = ?', addr).map((r) => [r.id, r.name]))
  return all("SELECT * FROM approvals WHERE addr = ? AND status = 'pending' ORDER BY hour DESC", addr).map((r) => ({ ...r, name: names[r.agent], token: BY_SYMBOL[r.symbol].address, decimals: BY_SYMBOL[r.symbol].decimals, expires: (r.hour + APPROVAL_HOURS) * 3600 }))
}
const pending = (addr, id) => { const r = one('SELECT * FROM approvals WHERE id = ?', id); if (!r || r.addr !== addr) throw err('That request is not yours.', 403); if (r.status !== 'pending') throw err(`That request is already ${r.status}.`); return r }
export function skip(addr, id) {
  const r = pending(addr, id)
  tx(() => { run("UPDATE approvals SET status = 'skipped', settled = ? WHERE id = ?", now(), id)
    run('INSERT OR REPLACE INTO decisions (agent, hour, symbol, action, price, qty, usd, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', r.agent, r.hour, r.symbol, 'hold', r.price, 0, 0, `You skipped the ${r.action}. ${r.reason}`) })
}
// the person signed the trade in their wallet: read what really happened and book that, not the estimate
export async function settle(addr, id, hash) {
  const r = pending(addr, id)
  if (one('SELECT 1 x FROM approvals WHERE tx = ?', hash) || one('SELECT 1 x FROM installs WHERE tx = ?', hash)) throw err('That transaction is already booked.')
  const fill = await fillOf(hash, addr, r.symbol, r.action)
  if (r.action === 'buy' && fill.usd > r.usd * 1.03 + 1) throw err(`That transaction spent $${fill.usd.toFixed(2)}, more than the $${r.usd.toFixed(2)} the agent asked for.`)
  const a = parse(one('SELECT * FROM agents WHERE id = ?', r.agent))
  apply(a.state, { symbol: r.symbol, action: r.action, usd: fill.usd, qty: fill.qty, price: fill.usd / fill.qty }, r.hour, fill); if (r.action === 'buy') a.state.trades++
  tx(() => {
    run("UPDATE approvals SET status = 'approved', tx = ?, settled = ?, usd = ?, qty = ?, price = ? WHERE id = ?", hash, now(), fill.usd, fill.qty, fill.usd / fill.qty, id)
    run('UPDATE agents SET state = ? WHERE id = ?', JSON.stringify(a.state), a.id)
    run('INSERT OR REPLACE INTO decisions (agent, hour, symbol, action, price, qty, usd, reason, tx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', r.agent, r.hour, r.symbol, r.action, fill.usd / fill.qty, fill.qty, fill.usd,
      `You approved it. ${r.action === 'buy' ? 'Bought' : 'Sold'} ${fill.qty.toFixed(6)} ${r.symbol} for $${fill.usd.toFixed(2)} on chain. ${r.reason}`, hash)
  })
  return fill
}

// ---- public views ----
export function summary(a) {
  const e = one('SELECT value, hold, hour FROM equity WHERE agent = ? ORDER BY hour DESC LIMIT 1', a.id) || { value: a.config.budget, hold: a.config.budget, hour: a.start_hour }
  const ret = (e.value / a.config.budget - 1) * 100, holdRet = (e.hold / a.config.budget - 1) * 100
  return { id: a.id, name: a.name, by: short(a.addr), house: !!a.house, status: a.status, mode: a.mode, kind: KIND[a.config.kind], markets: a.config.markets, budget: a.config.budget,
    value: e.value, ret, holdRet, vs: ret - holdRet, trades: a.state.trades, hours: e.hour - a.start_hour, since: a.start_hour, listing: a.listing, version: a.version }
}
export function board() { return all("SELECT * FROM agents WHERE status != 'stopped'").map(parse).map(summary).sort((x, y) => y.ret - x.ret || y.vs - x.vs) }
export function mine(addr) { return all('SELECT * FROM agents WHERE addr = ? ORDER BY created DESC', addr).map(parse).map(summary) }

export function detail(id) {
  const raw = one('SELECT * FROM agents WHERE id = ?', id); if (!raw) throw err('No agent with that id.', 404)
  const a = parse(raw), h = latestHour()
  const curve = all('SELECT hour, value, hold FROM equity WHERE agent = ? ORDER BY hour', id)
  const positions = Object.entries(a.state.pos).map(([k, p]) => { const c = series(k, h, h)[0]; return { symbol: k, qty: p.qty, entry: p.entry, price: c, value: p.qty * c, since: p.hour } })
  const pts = curve.length > 400 ? curve.filter((_, i) => i % Math.ceil(curve.length / 400) === 0 || i === curve.length - 1) : curve
  return { ...summary(a), brief: a.brief, plan: readable(a.config), permissions: permissions(a.config), cash: a.state.cash, positions, curve: pts.map((p) => [p.hour, p.value, p.hold]),
    decisions: all('SELECT hour, symbol, action, price, qty, usd, reason, tx FROM decisions WHERE agent = ? ORDER BY hour DESC, symbol LIMIT 240', id),
    receipts: all("SELECT hour, symbol, action, usd, qty, price, tx, settled FROM approvals WHERE agent = ? AND status = 'approved' ORDER BY settled DESC LIMIT 100", id), owner: a.addr, config: a.config }
}

// the public feed: trades first, then the latest waits so a quiet hour still shows the agents thinking
export function activity(limit = 40) {
  const names = Object.fromEntries(all('SELECT id, name FROM agents').map((r) => [r.id, r.name]))
  return all(`SELECT agent, hour, symbol, action, price, usd, reason, tx FROM decisions WHERE agent IN (SELECT id FROM agents WHERE status != 'stopped')
    ORDER BY hour DESC, CASE action WHEN 'hold' THEN 1 ELSE 0 END, agent LIMIT ?`, limit).map((d) => ({ ...d, name: names[d.agent] }))
}
// everything one wallet's agents did, newest first: the execution history
export function history(addr, limit = 200) {
  const names = Object.fromEntries(all('SELECT id, name FROM agents WHERE addr = ?', addr).map((r) => [r.id, r.name]))
  return all(`SELECT agent, hour, symbol, action, price, qty, usd, reason, tx FROM decisions WHERE agent IN (SELECT id FROM agents WHERE addr = ?) AND action != 'hold' ORDER BY hour DESC LIMIT ?`, addr, limit).map((d) => ({ ...d, name: names[d.agent] }))
}

export function marketsView() {
  const h = latestHour()
  return MARKETS.map((m) => { const s = series(m.symbol, h - 168, h), p = s[s.length - 1], d = s[s.length - 25], wk = s[0]
    return { symbol: m.symbol, name: m.name, type: m.type, address: m.address, price: p, change24h: p && d ? (p / d - 1) * 100 : null, change7d: p && wk ? (p / wk - 1) * 100 : null, week: s.filter((_, i) => i % 4 === 0), low7d: Math.min(...s.filter((x) => x != null)), high7d: Math.max(...s.filter((x) => x != null)),
      decisions24h: one('SELECT COUNT(*) n FROM decisions WHERE symbol = ? AND hour > ?', m.symbol, h - 24).n,
      agents: one("SELECT COUNT(*) n FROM agents WHERE status = 'live' AND config LIKE ?", `%"${m.symbol}"%`).n } })
}

export function stats() {
  return { agents: one("SELECT COUNT(*) n FROM agents WHERE status = 'live'").n, decisions: one('SELECT COUNT(*) n FROM decisions').n, trades: one("SELECT COUNT(*) n FROM decisions WHERE action IN ('buy','sell')").n,
    listings: one("SELECT COUNT(*) n FROM listings WHERE status = 'live'").n, installs: one('SELECT COUNT(*) n FROM installs').n, creators: one("SELECT COUNT(DISTINCT addr) n FROM listings WHERE status = 'live'").n,
    hours: one('SELECT COUNT(DISTINCT hour) n FROM closes').n, markets: MARKETS.length, lastHour: latestHour() }
}

// the 30-day simulation of a config on real hourly prices, cached for the hour (same config, same data, same answer)
const cache = new Map()
export function simulate(cfg) {
  const to = latestHour(), key = to + JSON.stringify(cfg)
  if (cache.has(key)) return cache.get(key)
  const r = replay(cfg, to - 720, to, series)
  const pts = r.curve.filter((_, i) => i % 6 === 0 || i === r.curve.length - 1)
  const out = { from: to - 720, to, budget: cfg.budget, ret: r.ret, holdRet: r.holdRet, vs: r.ret - r.holdRet, buys: r.buys, sells: r.sells, wins: r.state.wins, fees: r.fees, drawdown: r.drawdown, invested: r.invested, cash: r.cash,
    end: r.curve.length ? r.curve[r.curve.length - 1].value : cfg.budget, missing: r.missing, curve: pts.map((p) => [p.hour, Math.round(p.value * 100) / 100, Math.round(p.hold * 100) / 100]), log: r.log.slice(-80).reverse(),
    plan: readable(cfg), permissions: permissions(cfg) }
  if (cache.size > 400) cache.clear()
  cache.set(key, out); return out
}
