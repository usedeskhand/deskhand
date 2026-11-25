// The marketplace: a creator publishes a version of an agent, a buyer installs their own copy with their own budget.
// A paid listing is paid in USDG, wallet to wallet, and the server only checks the transfer on chain. Deskhand takes no cut.
import crypto from 'node:crypto'
import { all, one, run, tx, now } from './db.mjs'
import { clean, readable, permissions } from './engine.mjs'
import { BY_SYMBOL } from './markets.mjs'
import { create, simulate, short, HOUSE } from './agents.mjs'
import { paymentOf } from './chain.mjs'

const err = (m, code = 400) => Object.assign(new Error(m), { code })
const text = (s, n) => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n)
const KIND = { rules: 'Rules', dca: 'Scheduled buy', basket: 'Basket' }
const current = (l) => { const v = one('SELECT * FROM versions WHERE listing = ? AND version = ?', l.id, l.version); return { ...v, config: JSON.parse(v.config) } }

function card(l) {
  const v = current(l), sim = simulate(v.config)
  return { id: l.id, name: l.name, pitch: l.pitch, by: short(l.addr), house: !!l.house, version: l.version, price: l.price, updated: l.updated, kind: KIND[v.config.kind], markets: v.config.markets, budget: v.config.budget,
    installs: one('SELECT COUNT(*) n FROM installs WHERE listing = ?', l.id).n, ret: sim.ret, holdRet: sim.holdRet, vs: sim.vs, trades: sim.buys + sim.sells, drawdown: sim.drawdown, spark: sim.curve.filter((_, i) => i % 4 === 0).map((p) => p[1]) }
}
export function list() { return all("SELECT * FROM listings WHERE status = 'live'").map(card).sort((a, b) => b.installs - a.installs || b.ret - a.ret) }

export function get(id, viewer) {
  const l = one('SELECT * FROM listings WHERE id = ?', id); if (!l || (l.status !== 'live' && l.addr !== viewer)) throw err('No listing with that id.', 404)
  const v = current(l), own = viewer === l.addr
  return { ...card(l), status: l.status, brief: v.brief, plan: readable(v.config), permissions: permissions(v.config), sim: simulate(v.config), creator: l.addr === HOUSE ? null : l.addr, mine: own,
    installed: viewer ? one('SELECT agent FROM installs WHERE listing = ? AND addr = ? ORDER BY id DESC LIMIT 1', id, viewer)?.agent || null : null,
    versions: all('SELECT version, note, created FROM versions WHERE listing = ? ORDER BY version DESC', id),
    sales: own ? all('SELECT addr, version, paid, tx, created FROM installs WHERE listing = ? ORDER BY id DESC LIMIT 100', id).map((s) => ({ ...s, addr: short(s.addr) })) : undefined }
}

const ownAgent = (addr, id) => { const a = one('SELECT * FROM agents WHERE id = ?', id); if (!a || a.addr !== addr) throw err('Publish one of your own agents.', 403); return a }
export function publish(addr, input, house = false) {
  const a = ownAgent(addr, input.agent), pitch = text(input.pitch, 280), price = Math.round(Math.min(10_000, Math.max(0, +input.price || 0)) * 100) / 100
  if (a.listing && !house) { const src = one('SELECT addr FROM listings WHERE id = ?', a.listing); if (src && src.addr !== addr) throw err('This agent was installed from someone else’s listing, so it cannot be republished. Write your own brief instead.') }
  if (pitch.length < 20) throw err('Say in a sentence or two what the agent does and who it is for (20 characters at least).')
  if (!house && one("SELECT COUNT(*) n FROM listings WHERE addr = ? AND status = 'live'", addr).n >= 12) throw err('You have 12 live listings. Retire one to publish another.')
  const id = (house && input.id) || crypto.randomBytes(5).toString('hex'), t = now()
  tx(() => {
    run('INSERT INTO listings (id, addr, name, pitch, version, price, status, house, created, updated) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)', id, addr, text(input.name, 40) || a.name, pitch, price, 'live', house ? 1 : 0, t, t)
    run('INSERT INTO versions (listing, version, brief, config, note, created) VALUES (?, 1, ?, ?, ?, ?)', id, a.brief, a.config, 'First version.', t)
    run('UPDATE agents SET listing = ?, version = 1 WHERE id = ?', id, a.id)
  })
  return id
}
const ownListing = (addr, id) => { const l = one('SELECT * FROM listings WHERE id = ?', id); if (!l || l.addr !== addr) throw err('That listing is not yours.', 403); return l }
export function newVersion(addr, id, input) {
  const l = ownListing(addr, id), a = ownAgent(addr, input.agent), note = text(input.note, 200)
  if (note.length < 8) throw err('Say what changed in this version.')
  if (JSON.stringify(JSON.parse(a.config)) === JSON.stringify(current(l).config)) throw err('This agent has the same rules as the current version.')
  const n = l.version + 1, t = now()
  tx(() => { run('INSERT INTO versions (listing, version, brief, config, note, created) VALUES (?, ?, ?, ?, ?, ?)', id, n, a.brief, a.config, note, t); run('UPDATE listings SET version = ?, updated = ? WHERE id = ?', n, t, id) })
  return n
}
export function edit(addr, id, input) {
  const l = ownListing(addr, id)
  const pitch = input.pitch != null ? text(input.pitch, 280) : l.pitch, price = input.price != null ? Math.round(Math.min(10_000, Math.max(0, +input.price || 0)) * 100) / 100 : l.price
  const status = ['live', 'retired'].includes(input.status) ? input.status : l.status
  if (pitch.length < 20) throw err('The description needs 20 characters at least.')
  run('UPDATE listings SET pitch = ?, price = ?, status = ?, updated = ? WHERE id = ?', pitch, price, status, now(), id)
}

// the buyer's own copy: same rules, their budget, their mode. A paid listing needs the hash of the USDG transfer to the creator.
export async function install(addr, id, input) {
  const l = one("SELECT * FROM listings WHERE id = ? AND status = 'live'", id); if (!l) throw err('No listing with that id.', 404)
  const v = current(l); let paid = 0, hash = null
  if (l.price > 0 && l.addr !== addr && !one('SELECT 1 x FROM installs WHERE listing = ? AND addr = ? AND paid > 0', id, addr)) {
    hash = String(input.tx || ''); if (!hash) throw err(`This agent costs $${l.price.toFixed(2)}. Pay the creator from your wallet first.`, 402)
    if (one('SELECT 1 x FROM installs WHERE tx = ?', hash) || one('SELECT 1 x FROM approvals WHERE tx = ?', hash)) throw err('That payment was already used.')
    paid = await paymentOf(hash, addr, l.addr)
    if (paid + 0.005 < l.price) throw err(`That transaction sent $${paid.toFixed(2)} USDG to the creator. The price is $${l.price.toFixed(2)}.`)
  }
  const cfg = clean({ ...v.config, budget: +input.budget || v.config.budget, name: l.name }, BY_SYMBOL)
  if (cfg.kind === 'dca' && cfg.amount > cfg.budget) cfg.amount = cfg.budget
  const agent = create(addr, { config: cfg, brief: v.brief, mode: input.mode }, { listing: id, version: l.version })
  run('INSERT INTO installs (listing, version, addr, agent, paid, tx, created) VALUES (?, ?, ?, ?, ?, ?, ?)', id, l.version, addr, agent, paid, hash, now())
  return { agent, paid }
}

export function mineListings(addr) {
  return all('SELECT * FROM listings WHERE addr = ? ORDER BY created DESC', addr).map((l) => ({ ...card(l), status: l.status, earned: one('SELECT COALESCE(SUM(paid), 0) s FROM installs WHERE listing = ?', l.id).s }))
}
export function sales(addr) {
  return all('SELECT i.listing, l.name, i.addr, i.version, i.paid, i.tx, i.created FROM installs i JOIN listings l ON l.id = i.listing WHERE l.addr = ? ORDER BY i.id DESC LIMIT 100', addr).map((s) => ({ ...s, addr: short(s.addr) }))
}
