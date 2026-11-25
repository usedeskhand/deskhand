// Deskhand over MCP (Streamable HTTP, JSON responses): any AI agent can read briefs into rules, replay them on 30 days of
// real prices, read the markets, the marketplace, the leaderboard and the live decision log. Read-only: nothing here can
// start an agent or move funds; a person opens the link in the builder and decides there.
import { read } from './brief.mjs'
import { clean, readable } from './engine.mjs'
import { simulate, board, detail, activity, marketsView, stats } from './agents.mjs'
import { list, get } from './market.mjs'
import { series, latestHour } from './prices.mjs'
import { BY_SYMBOL } from './markets.mjs'

export const PROTOCOL = '2025-06-18'
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100)
const simOut = (s) => ({ window: { from: new Date(s.from * 3600e3).toISOString(), to: new Date(s.to * 3600e3).toISOString() }, budget: s.budget, end_value: r2(s.end),
  return_pct: r2(s.ret), holding_return_pct: r2(s.holdRet), vs_holding_pts: r2(s.vs), buys: s.buys, sells: s.sells, largest_drop_pct: r2(s.drawdown), costs_usd: r2(s.fees),
  rules: s.plan.map((l) => `${l.t}: ${l.d}`), permissions: s.permissions, last_trades: s.log.slice(0, 8).map((d) => ({ time: new Date(d.hour * 3600e3).toISOString(), action: d.action, symbol: d.symbol, usd: r2(d.usd), reason: d.reason })) })
const KIND = { type: 'string', enum: ['rules', 'dca', 'basket'] }

export const TOOLS = [
  { name: 'draft_agent', title: 'Draft an agent from plain English',
    description: 'Read a trading brief written in plain English (e.g. "Buy TSLA when it drops 5% in a day. Sell when it is up 8% or down 6%. Budget $2,000.") into Deskhand rules, and replay them on the last 30 days of hourly on-chain prices. Returns the rules, notes on anything assumed, the simulation, and a link that opens the draft in the Deskhand builder, where a person can start it. Understands scheduled buys, buy/sell rules (moves over a period, price levels, averages, recent highs/lows, RSI, take profit, stop loss) and baskets with target weights. Nothing is started.',
    inputSchema: { type: 'object', properties: { brief: { type: 'string', description: 'The strategy in plain English, up to 600 characters. Name the tokens, when to buy, when to sell and the budget.' } }, required: ['brief'] },
    run: ({ brief }, o) => { const r = read(brief); if (!r.config) return { ok: false, error: r.error, notes: r.notes }
      const cfg = clean(r.config, BY_SYMBOL); return { ok: true, name: cfg.name, kind: cfg.kind, config: cfg, notes: r.notes, simulation: simOut(simulate(cfg)), open_in_builder: `${o.origin}/app?brief=${encodeURIComponent(r.brief)}` } } },
  { name: 'simulate_agent', title: 'Replay an agent config',
    description: 'Replay an agent config (as returned by draft_agent, edited if you like: budget, amount, takeProfit, stopLoss, maxPerMarket, markets, weights) on the last 30 days of hourly on-chain prices, next to holding the same tokens. Costs of 0.4% are charged on every simulated trade.',
    inputSchema: { type: 'object', properties: { config: { type: 'object', description: 'An agent config with kind, markets, budget and the fields of its kind.', properties: { kind: KIND } } }, required: ['config'] },
    run: ({ config }) => { const cfg = clean(config, BY_SYMBOL); return { config: cfg, rules: readable(cfg).map((l) => `${l.t}: ${l.d}`), simulation: simOut(simulate(cfg)) } } },
  { name: 'list_markets', title: 'Markets', description: 'The 22 markets Deskhand agents trade on Robinhood Chain (20 stock tokens, BTC, ETH): last hourly price from the on-chain USDG pool, 24 h and 7 day change, and how many agents watch each one.',
    inputSchema: { type: 'object', properties: {} }, run: () => marketsView().map((m) => ({ symbol: m.symbol, name: m.name, type: m.type, token: m.address, price_usd: r2(m.price), change_24h_pct: r2(m.change24h), change_7d_pct: r2(m.change7d), agents_watching: m.agents })) },
  { name: 'get_market_prices', title: 'Hourly prices of one market', description: 'Hourly closes of one market over the last 30 days (one point every 6 hours by default), read from its pool on Robinhood Chain.',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'Ticker, e.g. NVDA, TSLA, SPY, BTC.' }, every_hours: { type: 'integer', minimum: 1, maximum: 24 } }, required: ['symbol'] },
    run: ({ symbol, every_hours = 6 }) => { const k = String(symbol).toUpperCase(); if (!BY_SYMBOL[k]) throw Object.assign(new Error('Unknown market. Call list_markets.'), { code: 400 })
      const h = latestHour(), s = series(k, h - 720, h), n = Math.max(1, Math.min(24, +every_hours || 6)); return { symbol: k, closes: s.map((c, i) => [new Date((h - 720 + i) * 3600e3).toISOString(), r2(c)]).filter((_, i) => i % n === 0 || i === s.length - 1) } } },
  { name: 'list_marketplace', title: 'Marketplace', description: 'Agents published on the Deskhand marketplace: what each does, its markets, price in USDG (0 = free), installs and its 30-day simulated result next to holding.',
    inputSchema: { type: 'object', properties: {} }, run: (_, o) => list().map((l) => ({ id: l.id, name: l.name, pitch: l.pitch, kind: l.kind, markets: l.markets, price_usdg: l.price, version: l.version, by: l.by, installs: l.installs, return_30d_pct: r2(l.ret), holding_30d_pct: r2(l.holdRet), url: `${o.origin}/market/${l.id}` })) },
  { name: 'get_listing', title: 'One listing', description: 'Full detail of one marketplace listing: its rules, the permissions it asks for, its versions and its 30-day simulation.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Listing id from list_marketplace.' } }, required: ['id'] },
    run: ({ id }, o) => { const l = get(String(id)); return { id: l.id, name: l.name, pitch: l.pitch, brief: l.brief, rules: l.plan.map((x) => `${x.t}: ${x.d}`), permissions: l.permissions, price_usdg: l.price, installs: l.installs, versions: l.versions, simulation: simOut(l.sim), url: `${o.origin}/market/${l.id}` } } },
  { name: 'leaderboard', title: 'Running agents', description: 'Every agent running on Deskhand, ranked by return since it started, with its mode (paper or wallet), markets, trades and the return of simply holding its tokens.',
    inputSchema: { type: 'object', properties: {} }, run: (_, o) => board().map((a) => ({ id: a.id, name: a.name, by: a.by, kind: a.kind, mode: a.mode, status: a.status, markets: a.markets, return_pct: r2(a.ret), holding_pct: r2(a.holdRet), trades: a.trades, hours_running: a.hours, url: `${o.origin}/agents/${a.id}` })) },
  { name: 'get_agent', title: 'One agent', description: 'One running agent: value, return, holdings, its rules and its latest decisions with the reason for each one.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Agent id from leaderboard.' } }, required: ['id'] },
    run: ({ id }, o) => { const a = detail(String(id)); return { id: a.id, name: a.name, kind: a.kind, mode: a.mode, status: a.status, value_usd: r2(a.value), budget_usd: a.budget, return_pct: r2(a.ret), holding_pct: r2(a.holdRet), trades: a.trades,
      holdings: a.positions.map((p) => ({ symbol: p.symbol, qty: p.qty, entry_usd: r2(p.entry), value_usd: r2(p.value) })), rules: a.plan.map((x) => `${x.t}: ${x.d}`),
      decisions: a.decisions.slice(0, 20).map((d) => ({ time: new Date(d.hour * 3600e3).toISOString(), action: d.action, symbol: d.symbol, reason: d.reason, tx: d.tx || undefined })), url: `${o.origin}/agents/${a.id}` } } },
  { name: 'recent_decisions', title: 'Live decision log', description: 'The latest decisions of the agents running on Deskhand, trades first, each with the reason the agent wrote.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    run: ({ limit = 30 }) => activity(Math.min(100, Math.max(1, +limit || 30))).map((d) => ({ time: new Date(d.hour * 3600e3).toISOString(), agent: d.name, action: d.action, symbol: d.symbol, price_usd: r2(d.price), usd: r2(d.usd), reason: d.reason })) },
  { name: 'stats', title: 'Deskhand in numbers', description: 'Live counts: agents running, decisions logged, trades, listings, installs, markets, and the last hour of prices read on chain.',
    inputSchema: { type: 'object', properties: {} }, run: () => stats() },
]
for (const t of TOOLS) t.annotations = { readOnlyHint: true, openWorldHint: false }

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result }), rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
export function handle(msg, o) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcErr(msg?.id ?? null, -32600, 'Invalid request')
  const { id, method, params = {} } = msg
  if (id === undefined) return null // a notification
  if (method === 'initialize') return rpc(id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'deskhand', title: 'Deskhand', version: '0.1.0' },
    instructions: 'Deskhand builds trading agents for stock tokens on Robinhood Chain from plain-English briefs. Use draft_agent to turn a strategy into rules and a 30-day replay, then give the person the open_in_builder link: only they can start an agent, from their own wallet. Never present a simulation as a forecast.' })
  if (method === 'ping') return rpc(id, {})
  if (method === 'tools/list') return rpc(id, { tools: TOOLS.map(({ run, ...t }) => t) })
  if (method === 'tools/call') {
    const t = TOOLS.find((x) => x.name === params.name); if (!t) return rpcErr(id, -32602, `Unknown tool: ${params.name}`)
    try { const out = t.run(params.arguments || {}, o); return rpc(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: Array.isArray(out) ? { items: out } : out }) }
    catch (e) { return rpc(id, { content: [{ type: 'text', text: e.message || 'Something went wrong.' }], isError: true }) }
  }
  return rpcErr(id, -32601, `Method not found: ${method}`)
}
