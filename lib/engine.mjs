// The decision engine. plan() reads one hour and says what the agent wants to do and why; apply() books a trade.
// The 30-day simulation, a paper agent and a wallet agent all go through plan(), so they decide the same way.
// Three kinds of agent: 'rules' (buy and sell conditions), 'dca' (a buy on a schedule) and 'basket' (target weights, rebalanced).
export const FEE = 0.004 // fees and slippage, charged on each simulated buy and sell
export const LOOKBACK = 168 // hours of history needed before the first decision (indicators go up to 7 days)
export const WINDOWS = [1, 6, 12, 24, 48, 72, 168]
export const DEFAULT_BUDGET = 1000

// ---- indicators on a window of closes (oldest first, the last one is the current hour) ----
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const last = (w) => w[w.length - 1]
const slice = (w, h, skipNow = false) => (skipNow ? w.slice(-h - 1, -1) : w.slice(-h))
export const IND = {
  price: (w) => last(w),
  avg: (w, h) => mean(slice(w, h)),
  high: (w, h) => Math.max(...slice(w, h, true)),
  low: (w, h) => Math.min(...slice(w, h, true)),
  change: (w, h) => (last(w) / w[w.length - 1 - h] - 1) * 100,
  rsi: (w, h) => { let up = 0, dn = 0; for (let i = w.length - h; i < w.length; i++) { const d = w[i] - w[i - 1]; if (d > 0) up += d; else dn -= d }
    return dn === 0 ? 100 : 100 - 100 / (1 + up / dn) },
}
const span = (h) => (h % 24 === 0 ? `${h / 24}-day` : `${h}-hour`)
const NAMES = { avg: 'average', high: 'high', low: 'low', change: 'change', rsi: 'RSI' }
export const label = (x) => x.k === 'num' ? (x.usd ? usd(x.v) : String(x.v)) : x.k === 'price' ? 'price' : `${span(x.h)} ${NAMES[x.k]}`
const val = (x, w) => (x.k === 'num' ? x.v : IND[x.k](w, x.h))
const fmt = (k, v) => k === 'change' ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%` : k === 'rsi' ? v.toFixed(0) : usd(v)
export const usd = (v) => (v < 0 ? '−' : '') + '$' + (Math.abs(v) >= 1000 ? Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : Math.abs(v) >= 1 ? Math.abs(v).toFixed(2) : Math.abs(v).toFixed(4))
const pctTxt = (m) => `${m >= 0 ? '+' : '−'}${Math.abs(m * 100).toFixed(1)}%`

// a rule: {a, op, b, pct}; a is an indicator, b an indicator or {k:'num', v}; pct moves b by that many percent (−2 = 2% under)
const VERB = { above: 'is above', below: 'is below', crosses_above: 'crosses above', crosses_below: 'crosses below' }
export const describe = (r) => {
  const b = r.b.k === 'num' ? (r.a.k === 'change' ? `${r.b.v >= 0 ? '+' : '−'}${Math.abs(r.b.v)}%` : r.a.k === 'rsi' ? String(r.b.v) : usd(r.b.v)) : `its ${label(r.b)}`
  const off = r.pct ? `${Math.abs(r.pct)}% ${r.pct > 0 ? 'above' : 'below'} ` : ''
  const a = r.a.k === 'price' ? 'the price' : `the ${label(r.a)}`
  if (r.pct) return `${a} ${r.op.startsWith('crosses') ? (r.op.endsWith('above') ? 'crosses' : 'falls to') : 'is'} ${off}${b}`
  return `${a} ${VERB[r.op]} ${b}`
}
function test(rule, w, prev) {
  const b0 = (w2) => { const v = val(rule.b, w2); return rule.pct ? v * (1 + rule.pct / 100) : v }
  const a = val(rule.a, w), b = b0(w)
  let ok
  if (rule.op === 'above') ok = a > b
  else if (rule.op === 'below') ok = a < b
  else { const pa = val(rule.a, prev), pb = b0(prev); ok = rule.op === 'crosses_above' ? pa <= pb && a > b : pa >= pb && a < b }
  const now = rule.a.k === 'price' ? `price ${usd(a)}` : `${label(rule.a)} ${fmt(rule.a.k, a)}`
  const ref = rule.b.k === 'num' ? '' : ` (${usd(b)})`
  return { ok, text: `${ok ? 'met' : 'not met'}: ${describe(rule)}${ref}, now ${now}` }
}

// ---- one hour ----
// state: {cash, pos: {SYM: {qty, entry, hour}}, trades, wins, spent, lastRun}; windows: {SYM: closes up to and including this hour}
// returns intents: {symbol, action: 'buy'|'sell'|'hold', usd, qty, price, reason}
export function plan(cfg, state, windows, hour) {
  const out = []
  const ready = (sym) => { const w = windows[sym]; return w && w.length >= LOOKBACK + 1 && !w.some((x) => x == null) }
  const equity = () => state.cash + Object.entries(state.pos).reduce((s, [k, p]) => s + p.qty * (last(windows[k] || []) || p.entry), 0)
  const cap = (sym) => equity() * (cfg.maxPerMarket || 1) - (state.pos[sym] ? state.pos[sym].qty * last(windows[sym]) : 0) // room left in this market
  const exits = (sym, price, held) => {
    const move = price / held.entry - 1
    if (cfg.stopLoss && move <= -cfg.stopLoss) return `Stop loss hit: ${pctTxt(move)} from the average entry at ${usd(held.entry)}. Selling the whole position.`
    if (cfg.takeProfit && move >= cfg.takeProfit) return `Take profit hit: ${pctTxt(move)} from the average entry at ${usd(held.entry)}. Selling the whole position.`
    if (cfg.maxHold && hour - held.hour >= cfg.maxHold) return `Held for ${hour - held.hour} hours, the longest this agent allows. Selling.`
    return null
  }
  const sellAll = (sym, price, held, reason) => out.push({ symbol: sym, action: 'sell', usd: held.qty * price, qty: held.qty, price, reason })

  if (cfg.kind === 'basket') {
    const syms = cfg.markets.filter(ready); if (syms.length < cfg.markets.length) return cfg.markets.map((s) => ({ symbol: s, action: 'hold', usd: 0, qty: 0, price: last(windows[s] || []) || 0, reason: 'Waiting for a full week of prices on every market in the basket.' }))
    const eq = equity(), due = state.lastRun == null || hour - state.lastRun >= cfg.every
    const cur = Object.fromEntries(syms.map((s) => [s, state.pos[s] ? (state.pos[s].qty * last(windows[s])) / eq : 0]))
    const worst = Math.max(...syms.map((s) => Math.abs(cur[s] - cfg.weights[s]))) * 100
    const drifted = cfg.drift && worst >= cfg.drift
    for (const s of syms) {
      const price = last(windows[s]), target = cfg.weights[s] * eq, have = state.pos[s] ? state.pos[s].qty * price : 0, diff = target - have
      const share = `${(cur[s] * 100).toFixed(1)}% of the basket, target ${(cfg.weights[s] * 100).toFixed(0)}%`
      if (!(due || drifted)) { out.push({ symbol: s, action: 'hold', usd: 0, qty: 0, price, reason: `Holding: ${share}. Next rebalance in ${cfg.every - (hour - state.lastRun)} hours${cfg.drift ? `, or sooner if a weight drifts ${cfg.drift} points` : ''}.` }); continue }
      const why = state.lastRun == null ? 'First run' : drifted && !due ? `A weight drifted ${worst.toFixed(1)} points` : 'Scheduled rebalance'
      if (Math.abs(diff) < Math.max(5, eq * 0.005)) out.push({ symbol: s, action: 'hold', usd: 0, qty: 0, price, reason: `${why}: ${share}. Close enough, no trade.` })
      else if (diff > 0) out.push({ symbol: s, action: 'buy', usd: diff, qty: (diff * (1 - FEE)) / price, price, reason: `${why}: ${share}. Buying ${usd(diff)} to get back to target.` })
      else out.push({ symbol: s, action: 'sell', usd: -diff, qty: -diff / price, price, reason: `${why}: ${share}. Selling ${usd(-diff)} to get back to target.` })
    }
    out.sort((a, b) => (a.action === 'sell' ? 0 : 1) - (b.action === 'sell' ? 0 : 1))
    // a buy can only use the cash that is there once the sells are done
    let cash = state.cash + out.filter((o) => o.action === 'sell').reduce((s, o) => s + o.usd * (1 - FEE), 0)
    for (const o of out) if (o.action === 'buy') { const u = Math.min(o.usd, cash); if (u < 5) { o.action = 'hold'; o.reason += ' Not enough cash for it.'; o.usd = 0; o.qty = 0 } else { o.qty *= u / o.usd; o.usd = u; cash -= u } }
    if (due || drifted) out.due = true
    return out
  }

  for (const sym of cfg.markets) {
    if (!ready(sym)) continue
    const w = windows[sym], price = last(w), prev = w.slice(0, -1), held = state.pos[sym]
    if (held) { const why = exits(sym, price, held); if (why) { sellAll(sym, price, held, why); continue } }

    if (cfg.kind === 'dca') {
      const d = new Date(hour * 3600e3), onDay = cfg.dow == null || d.getUTCDay() === cfg.dow, onHour = d.getUTCHours() === (cfg.at ?? 14)
      const due = cfg.every < 24 ? state.lastRun?.[sym] == null || hour - state.lastRun[sym] >= cfg.every : onDay && onHour && (state.lastRun?.[sym] == null || hour - state.lastRun[sym] >= cfg.every - 12)
      if (!due) { out.push({ symbol: sym, action: 'hold', usd: 0, qty: held?.qty || 0, price, reason: `Not a buying hour. ${held ? `Holding ${pctTxt(price / held.entry - 1)} from the average entry.` : 'Nothing bought yet.'}` }); continue }
      const tests = (cfg.rules?.buy || []).map((r) => test(r, w, prev)), miss = tests.find((t) => !t.ok)
      if (miss) { out.push({ symbol: sym, action: 'hold', usd: 0, qty: held?.qty || 0, price, reason: `Buying hour, but the condition is ${miss.text}. Skipping this one.`, ran: true }); continue }
      const size = Math.min(cfg.amount, state.cash)
      if (size < 5) { out.push({ symbol: sym, action: 'hold', usd: 0, qty: held?.qty || 0, price, reason: `Buying hour, but the budget is spent (${usd(state.cash)} left).`, ran: true }); continue }
      out.push({ symbol: sym, action: 'buy', usd: size, qty: (size * (1 - FEE)) / price, price, reason: `Scheduled buy${tests.length ? ` (${tests.map((t) => t.text).join('; ')})` : ''}. Buying ${usd(size)}.`, ran: true })
      continue
    }

    // rules
    const rules = cfg.rules || { buy: [], sell: [] }
    if (held) {
      const ts = rules.sell.map((r) => test(r, w, prev)), hit = ts.find((t) => t.ok)
      if (hit) sellAll(sym, price, held, `Sell rule ${hit.text}. Selling the whole position.`)
      else out.push({ symbol: sym, action: 'hold', usd: 0, qty: held.qty, price, reason: `Holding, ${pctTxt(price / held.entry - 1)} since entry.${ts[0] ? ` Sell rule ${ts[0].text}.` : ''}` })
      continue
    }
    const tests = rules.buy.map((r) => test(r, w, prev))
    if (tests.length && tests.every((t) => t.ok)) {
      const size = Math.min(state.cash, cfg.amount || Infinity, Math.max(0, cap(sym)))
      if (size < 5) { out.push({ symbol: sym, action: 'hold', usd: 0, qty: 0, price, reason: `Buy rule ${tests[0].text}, but no budget is left for it.` }); continue }
      out.push({ symbol: sym, action: 'buy', usd: size, qty: (size * (1 - FEE)) / price, price, reason: `Buy rule ${tests.map((t) => t.text).join('; ')}. Buying ${usd(size)}.` })
    } else {
      const miss = tests.find((t) => !t.ok)
      out.push({ symbol: sym, action: 'hold', usd: 0, qty: 0, price, reason: miss ? `Waiting. Buy rule ${miss.text}.` : 'Waiting.' })
    }
  }
  return out
}

// book one trade. fill = what really happened on chain ({usd, qty}); without it the simulated fill of the intent is used.
export function apply(state, it, hour, fill) {
  if (it.action === 'buy') {
    const usdIn = fill?.usd ?? it.usd, qty = fill?.qty ?? it.qty, p = state.pos[it.symbol]
    state.cash -= usdIn; state.spent = (state.spent || 0) + usdIn
    state.pos[it.symbol] = p ? { qty: p.qty + qty, entry: (p.qty * p.entry + usdIn) / (p.qty + qty), hour: p.hour } : { qty, entry: usdIn / qty, hour }
  } else if (it.action === 'sell') {
    const p = state.pos[it.symbol]; if (!p) return
    const qty = Math.min(fill?.qty ?? it.qty, p.qty), got = fill?.usd ?? qty * it.price * (1 - FEE)
    state.cash += got; state.trades++; if (got > qty * p.entry) state.wins++
    if (p.qty - qty < 1e-12 || (p.qty - qty) * it.price < 0.01) delete state.pos[it.symbol]; else p.qty -= qty
  }
}
// what plan() scheduled this hour, whether or not it traded (so a skipped buy is not retried every hour)
export function mark(cfg, state, intents, hour) {
  if (cfg.kind === 'basket') { if (intents.due) state.lastRun = hour }
  else if (cfg.kind === 'dca') { state.lastRun ||= {}; for (const it of intents) if (it.ran) state.lastRun[it.symbol] = hour }
}
export function step(cfg, state, windows, hour) {
  const intents = plan(cfg, state, windows, hour)
  for (const it of intents) if (it.action !== 'hold') { apply(state, it, hour); if (it.action === 'buy') state.trades++ }
  mark(cfg, state, intents, hour)
  const equity = state.cash + Object.entries(state.pos).reduce((s, [k, p]) => s + p.qty * (last(windows[k] || []) || p.entry), 0)
  return { decisions: intents, equity }
}
export const fresh = (cfg) => ({ cash: cfg.budget, pos: {}, trades: 0, wins: 0, spent: 0, lastRun: null })

// the comparison: the same budget put in the same markets on the first hour (the basket's weights, equal weights otherwise) and never touched
export function holdValue(cfg, first, nowW) {
  const wt = (k) => (cfg.kind === 'basket' ? cfg.weights[k] : 1 / cfg.markets.length)
  return cfg.markets.reduce((s, k) => { const a = first[k], b = last(nowW[k] || []); const per = cfg.budget * wt(k); return s + (a && b ? ((per * (1 - FEE)) / a) * b : per) }, 0)
    + (cfg.kind === 'basket' ? cfg.budget * (1 - cfg.markets.reduce((s, k) => s + cfg.weights[k], 0)) : 0)
}

// replay a config over [from, to] given a series getter (sym, a, b) → closes
export function replay(cfg, from, to, series) {
  const full = Object.fromEntries(cfg.markets.map((k) => [k, series(k, from - LOOKBACK, to)]))
  const at = (i) => Object.fromEntries(cfg.markets.map((k) => [k, full[k].slice(0, LOOKBACK + 1 + i)]))
  const state = fresh(cfg), curve = [], log = [], first = Object.fromEntries(cfg.markets.map((k) => [k, last(at(0)[k])]))
  let peak = cfg.budget, dd = 0, buys = 0, sells = 0, fees = 0
  for (let h = from, i = 0; h <= to; h++, i++) {
    const w = at(i), r = step(cfg, state, w, h)
    curve.push({ hour: h, value: r.equity, hold: holdValue(cfg, first, w) })
    peak = Math.max(peak, r.equity); dd = Math.max(dd, 1 - r.equity / peak)
    for (const d of r.decisions) if (d.action !== 'hold') { log.push({ hour: h, ...d }); fees += d.usd * FEE; if (d.action === 'buy') buys++; else sells++ }
  }
  const end = curve[curve.length - 1] || { value: cfg.budget, hold: cfg.budget }
  const invested = Object.entries(state.pos).reduce((s, [k, p]) => s + p.qty * last(full[k]), 0)
  return { curve, log, state, ret: (end.value / cfg.budget - 1) * 100, holdRet: (end.hold / cfg.budget - 1) * 100, buys, sells, fees, drawdown: dd * 100, invested, cash: state.cash,
    missing: cfg.markets.filter((k) => full[k].slice(0, LOOKBACK + 1).some((x) => x == null)) }
}

// ---- the plan a person can read before turning the agent on ----
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const everyTxt = (h) => (h === 1 ? 'every hour' : h < 24 ? `every ${h} hours` : h === 24 ? 'every day' : h === 168 ? 'every week' : h === 720 ? 'every 30 days' : `every ${h / 24} days`)
export function readable(cfg) {
  const out = [], list = cfg.markets.join(', ')
  if (cfg.kind === 'basket') {
    out.push({ t: 'Holds', d: cfg.markets.map((k) => `${(cfg.weights[k] * 100).toFixed(0)}% ${k}`).join(', ') + (cfg.markets.reduce((s, k) => s + cfg.weights[k], 0) < 0.995 ? `, the rest in USDG` : '') })
    out.push({ t: 'Rebalances', d: `${everyTxt(cfg.every)}${cfg.drift ? `, or as soon as a weight is ${cfg.drift} points off target` : ''}` })
  } else if (cfg.kind === 'dca') {
    out.push({ t: 'Buys', d: `${usd(cfg.amount)} of ${cfg.markets.length > 1 ? 'each of ' : ''}${list} ${cfg.every < 24 ? everyTxt(cfg.every) : `${cfg.dow != null ? `every ${DOW[cfg.dow]}` : everyTxt(cfg.every)} at ${String(cfg.at ?? 14).padStart(2, '0')}:00 UTC`}` })
    if (cfg.rules?.buy?.length) out.push({ t: 'Only if', d: cfg.rules.buy.map(describe).join(' and ') })
  } else {
    out.push({ t: 'Watches', d: list })
    out.push({ t: 'Buys when', d: cfg.rules.buy.map(describe).join(' and ') })
    if (cfg.rules.sell.length) out.push({ t: 'Sells when', d: cfg.rules.sell.map(describe).join(', or ') })
    out.push({ t: 'Size', d: `${cfg.amount ? `${usd(cfg.amount)} per buy` : 'whatever is left of the budget'}${cfg.maxPerMarket < 0.995 ? `, at most ${(cfg.maxPerMarket * 100).toFixed(0)}% of the budget in one market` : ''}` })
  }
  if (cfg.takeProfit) out.push({ t: 'Take profit', d: `sells a position that is up ${(cfg.takeProfit * 100).toFixed(0)}% from its average entry` })
  if (cfg.stopLoss) out.push({ t: 'Stop loss', d: `sells a position that is down ${(cfg.stopLoss * 100).toFixed(0)}% from its average entry` })
  if (cfg.maxHold) out.push({ t: 'Max holding time', d: `${cfg.maxHold} hours` })
  out.push({ t: 'Budget', d: `${usd(cfg.budget)} in total. The agent can never spend more than what is left of it.` })
  return out
}
// the permissions an agent asks for: what it may touch, and how much
export const permissions = (cfg) => ({ assets: ['USDG', ...cfg.markets], budget: cfg.budget, perTrade: cfg.kind === 'dca' ? cfg.amount : cfg.kind === 'rules' ? Math.min(cfg.amount || Infinity, cfg.budget * cfg.maxPerMarket) : cfg.budget,
  sells: cfg.kind !== 'dca' || !!(cfg.takeProfit || cfg.stopLoss || cfg.maxHold) })

// ---- config checks ----
const KINDS = new Set(['price', 'avg', 'high', 'low', 'change', 'rsi', 'num'])
const OPS = new Set(['above', 'below', 'crosses_above', 'crosses_below'])
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0))
const err = (m) => Object.assign(new Error(m), { code: 400 })
const okInd = (x) => x && KINDS.has(x.k) && (x.k === 'num' ? Number.isFinite(x.v) : x.k === 'price' || WINDOWS.includes(x.h))
const rule = (r) => { if (!okInd(r?.a) || !okInd(r?.b) || !OPS.has(r.op) || r.a.k === 'num') throw err('One of the rules is incomplete.'); return { a: r.a, op: r.op, b: r.b.k === 'num' ? { k: 'num', v: r.b.v } : r.b, pct: clamp(r.pct, -50, 50) } }
export function clean(input, markets) {
  const kind = ['rules', 'dca', 'basket'].includes(input?.kind) ? input.kind : null
  if (!kind) throw err('Describe what the agent should do first.')
  const c = { kind, name: String(input.name || '').replace(/[<>]/g, '').trim().slice(0, 40) || 'Untitled agent', markets: [...new Set(input.markets || [])].filter((m) => markets[m]).slice(0, 6),
    budget: Math.round(clamp(input.budget || DEFAULT_BUDGET, 20, 1_000_000) * 100) / 100, stopLoss: clamp(input.stopLoss, 0, 0.9), takeProfit: clamp(input.takeProfit, 0, 5), maxHold: Math.round(clamp(input.maxHold, 0, 720)) }
  if (!c.markets.length) throw err('Name at least one market, for example NVDA or SPY.')
  if (kind === 'basket') {
    const w = Object.fromEntries(c.markets.map((k) => [k, clamp(input.weights?.[k], 0, 1)])), sum = c.markets.reduce((s, k) => s + w[k], 0)
    if (c.markets.length < 2) throw err('A basket needs at least two markets.')
    if (c.markets.some((k) => w[k] <= 0)) throw err('Give every market in the basket a weight.')
    if (sum > 1.001) throw err(`The weights add up to ${(sum * 100).toFixed(0)}%. They cannot go over 100%.`)
    c.weights = w; c.every = [24, 168, 336, 720].includes(+input.every) ? +input.every : 168; c.drift = clamp(input.drift, 0, 50); c.maxPerMarket = 1
  } else if (kind === 'dca') {
    c.amount = Math.round(clamp(input.amount, 5, c.budget) * 100) / 100; c.every = [1, 6, 12, 24, 168, 336, 720].includes(+input.every) ? +input.every : 168
    c.dow = c.every === 168 || c.every === 336 ? Math.round(clamp(input.dow ?? 1, 0, 6)) : null; c.at = Math.round(clamp(input.at ?? 14, 0, 23)); c.maxPerMarket = 1
    c.rules = { buy: (input.rules?.buy || []).slice(0, 3).map(rule), sell: [] }
  } else {
    c.rules = { buy: (input.rules?.buy || []).slice(0, 4).map(rule), sell: (input.rules?.sell || []).slice(0, 4).map(rule) }
    c.amount = input.amount ? Math.round(clamp(input.amount, 5, c.budget) * 100) / 100 : 0; c.maxPerMarket = clamp(input.maxPerMarket ?? Math.max(0.25, 1 / c.markets.length), 0.05, 1)
    if (!c.rules.buy.length) throw err('Say when the agent should buy, for example "buy when it drops 5% in a day".')
    if (!c.rules.sell.length && !c.stopLoss && !c.takeProfit && !c.maxHold) throw err('Say when the agent should sell: a sell rule, a take profit, a stop loss or a maximum holding time.')
  }
  return c
}
