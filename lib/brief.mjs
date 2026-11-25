// Plain English → an agent config. No model in the loop: a fixed reader, so the same sentence always gives the same rules,
// and anything it did not understand is handed back to the person instead of being guessed.
import { MARKETS } from './markets.mjs'
import { WINDOWS, DEFAULT_BUDGET } from './engine.mjs'

const ALIASES = { nvidia: 'NVDA', tesla: 'TSLA', apple: 'AAPL', amazon: 'AMZN', google: 'GOOGL', alphabet: 'GOOGL', meta: 'META', facebook: 'META', palantir: 'PLTR', gamestop: 'GME', amc: 'AMC',
  alibaba: 'BABA', circle: 'CRCL', gold: 'GLD', 's&p 500': 'SPY', 's&p': 'SPY', sp500: 'SPY', 'the s&p': 'SPY', nasdaq: 'QQQ', strategy: 'MSTR', microstrategy: 'MSTR', micron: 'MU', reddit: 'RDDT',
  spacex: 'SPCX', tsmc: 'TSM', 'taiwan semi': 'TSM', oil: 'USO', bitcoin: 'BTC', ethereum: 'ETH', ether: 'ETH' }
const SYMS = MARKETS.map((m) => m.symbol)
const GROUPS = { 'chip stocks': ['NVDA', 'MU', 'TSM'], chips: ['NVDA', 'MU', 'TSM'], semis: ['NVDA', 'MU', 'TSM'], 'meme stocks': ['GME', 'AMC'], memes: ['GME', 'AMC'], 'big tech': ['AAPL', 'AMZN', 'GOOGL', 'META', 'NVDA'],
  'the indexes': ['SPY', 'QQQ'], indexes: ['SPY', 'QQQ'], indices: ['SPY', 'QQQ'], crypto: ['BTC', 'ETH'] }
const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, twelve: 12 }
const num = (s) => (s in NUMW ? NUMW[s] : parseFloat(String(s).replace(/,/g, '')))
const money = (s) => { const m = /^([\d,.]+)\s*(k|m)?$/i.exec(s.trim()); return m ? parseFloat(m[1].replace(/,/g, '')) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1) : NaN }
const snap = (h) => WINDOWS.reduce((b, w) => (Math.abs(w - h) < Math.abs(b - h) ? w : b), 24)
const MONEY = String.raw`(?:\$\s*([\d,.]+\s*[km]?)\b|([\d,.]+\s*[km]?)\s*(?:dollars|usd|usdg|bucks)\b)`
const PERIOD = String.raw`(?:(?:in|over|within|during)\s+)?(?:the\s+)?(?:last\s+|past\s+)?(?:(an?|one|two|three|four|five|six|seven|ten|twelve|\d+)[\s-]*)?(hours?|hrs?|h|days?|d|weeks?|w)\b`
const hours = (n, unit) => { const k = n ? num(n) : 1; return /^h/.test(unit) ? k : /^d/.test(unit) ? k * 24 : k * 168 }

function findMarkets(text) {
  const out = [], low = text.toLowerCase()
  const hits = []
  for (const s of SYMS) for (const m of text.matchAll(new RegExp(`(?<![A-Za-z])\\$?${s}(?![A-Za-z])`, s.length <= 3 ? 'g' : 'gi'))) hits.push([m.index, s])
  for (const [k, s] of Object.entries(ALIASES)) for (const m of low.matchAll(new RegExp(`(?<![a-z])${k.replace(/[&]/g, '\\$&')}(?![a-z])`, 'g'))) hits.push([m.index, s])
  for (const [k, list] of Object.entries(GROUPS)) for (const m of low.matchAll(new RegExp(`(?<![a-z])${k}(?![a-z])`, 'g'))) list.forEach((s, i) => hits.push([m.index + i / 10, s]))
  hits.sort((a, b) => a[0] - b[0]); for (const [, s] of hits) if (!out.includes(s)) out.push(s)
  return out
}

// one clause → rules. side is 'buy' or 'sell'; returns {rules, exits, used}
function conditions(clause, side) {
  const rules = [], exits = {}, used = []; let s = clause.toLowerCase(); const take = (re, fn) => { let m; while ((m = re.exec(s))) { if (fn(m) === false) break; used.push(m[0].trim()); s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length); re.lastIndex = 0 } }
  const P = { k: 'price' }
  // "5% below its 48h average", "2% above the 7 day high"
  take(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*%\s*(below|under|above|over)\s+(?:its|the|their)?\s*(?:(\d+|an?|one|two|three|seven)[\s-]*(hours?|hrs?|h|days?|d|weeks?|w)\s+)?(?:moving\s+)?(average|avg|mean|high|low)`), (m) => {
    const down = /below|under/.test(m[2]), k = /high/.test(m[5]) ? 'high' : /low/.test(m[5]) ? 'low' : 'avg', h = snap(m[4] ? hours(m[3], m[4]) : 48)
    rules.push({ a: P, op: down ? 'below' : 'above', b: { k, h }, pct: (down ? -1 : 1) * +m[1] }) })
  // "below its 48 hour average", "above the 7-day average", "under its weekly average"
  take(new RegExp(String.raw`(crosses\s+|breaks\s+|closes\s+|is\s+|goes\s+|trades\s+|falls\s+|drops\s+|rises\s+|moves\s+|back\s+)?(below|under|above|over)\s+(?:its|the|their)?\s*(?:(\d+|an?|one|two|three|seven)[\s-]*(hours?|hrs?|h|days?|d|weeks?|w)|(daily|weekly))?\s*(?:moving\s+)?(average|avg|mean|high|low)`), (m) => {
    const down = /below|under/.test(m[2]), k = /high/.test(m[6]) ? 'high' : /low/.test(m[6]) ? 'low' : 'avg', h = snap(m[4] ? hours(m[3], m[4]) : m[5] === 'weekly' ? 168 : m[5] === 'daily' ? 24 : 48)
    const cross = /cross|break/.test(m[1] || '') || k !== 'avg'
    rules.push({ a: P, op: (cross ? 'crosses_' : '') + (down ? 'below' : 'above'), b: { k, h }, pct: 0 }) })
  // "new 3-day high", "breaks out", "new weekly low"
  take(new RegExp(String.raw`(?:makes|hits|sets|prints|at)?\s*(?:a\s+)?new\s+(?:(\d+|an?|one|two|three|seven)[\s-]*(hours?|hrs?|h|days?|d|weeks?|w)|(daily|weekly))?\s*(high|low)`), (m) => {
    const h = snap(m[2] ? hours(m[1], m[2]) : m[3] === 'weekly' ? 168 : m[3] === 'daily' ? 24 : 72); rules.push({ a: P, op: m[4] === 'high' ? 'crosses_above' : 'crosses_below', b: { k: m[4], h }, pct: 0 }) })
  take(/\bbreaks?\s*out\b|\bbreakouts?\b/, () => { rules.push({ a: P, op: 'crosses_above', b: { k: 'high', h: 72 }, pct: 0 }) })
  // RSI
  take(/\brsi\s*(?:\(?(\d+)\)?\s*)?(?:is\s+|goes\s+|drops\s+|falls\s+|rises\s+|gets\s+)?(below|under|above|over|<|>)\s*(\d+)/, (m) => { rules.push({ a: { k: 'rsi', h: snap(m[1] ? +m[1] : 24) }, op: /below|under|</.test(m[2]) ? 'below' : 'above', b: { k: 'num', v: +m[3] }, pct: 0 }) })
  take(/\boversold\b/, () => { rules.push({ a: { k: 'rsi', h: 24 }, op: 'below', b: { k: 'num', v: 30 }, pct: 0 }) })
  take(/\boverbought\b/, () => { rules.push({ a: { k: 'rsi', h: 24 }, op: 'above', b: { k: 'num', v: 70 }, pct: 0 }) })
  // exits said in plain words: "take profit at 10%", "stop loss 5%", "hold at most 3 days"
  take(/(?:take[\s-]*profits?|tp)\s*(?:at|of|is|:)?\s*\+?(\d+(?:\.\d+)?)\s*%/, (m) => { exits.takeProfit = +m[1] / 100 })
  take(/(?:stop[\s-]*loss|stop|sl|cut\s+(?:my\s+)?loss(?:es)?)\s*(?:at|of|is|:)?\s*-?(\d+(?:\.\d+)?)\s*%/, (m) => { exits.stopLoss = +m[1] / 100 })
  take(new RegExp(String.raw`(?:hold|keep|held)\s+(?:it\s+|them\s+|a\s+position\s+)?(?:for\s+)?(?:at\s+most|no\s+(?:more|longer)\s+than|max(?:imum)?(?:\s+of)?|up\s+to)\s+(\d+|an?|one|two|three|seven)[\s-]*(hours?|hrs?|h|days?|d|weeks?|w)`), (m) => { exits.maxHold = Math.min(720, hours(m[1], m[2])) })
  take(new RegExp(String.raw`(?:after|once\s+held\s+for)\s+(\d+|an?|one|two|three|seven)[\s-]*(hours?|hrs?|h|days?|d|weeks?|w)\b`), (m) => { if (side !== 'sell') return false; exits.maxHold = Math.min(720, hours(m[1], m[2])) })
  // moves: "drops 5% in a day", "is up 3% over 6 hours", "falls more than 4% in a week"; without a period, a sell clause means "from my entry"
  take(new RegExp(String.raw`(drops?|falls?|dips?|down|loses?|lost|sinks?|slides?|rises?|gains?|up|jumps?|climbs?|rall(?:y|ies)|pumps?)\s*(?:by\s+)?(?:more\s+than\s+|at\s+least\s+|over\s+)?(\d+(?:\.\d+)?)\s*%(?:\s+or\s+more)?(?:\s+${PERIOD})?`), (m) => {
    const down = /^(drop|fall|dip|down|lose|lost|sink|slide)/.test(m[1]), pct = +m[2]
    if (!m[4]) { if (side === 'sell') { if (down) exits.stopLoss = pct / 100; else exits.takeProfit = pct / 100; return }
      rules.push({ a: { k: 'change', h: 24 }, op: down ? 'below' : 'above', b: { k: 'num', v: down ? -pct : pct }, pct: 0 }); return }
    rules.push({ a: { k: 'change', h: snap(hours(m[3], m[4])) }, op: down ? 'below' : 'above', b: { k: 'num', v: down ? -pct : pct }, pct: 0 }) })
  // price levels: "below $150", "above 200 dollars"
  take(new RegExp(String.raw`(crosses\s+|breaks\s+)?(below|under|above|over)\s+${MONEY}`), (m) => { const v = money(m[3] || m[4]); if (!(v > 0)) return false
    rules.push({ a: P, op: (m[1] ? 'crosses_' : '') + (/below|under/.test(m[2]) ? 'below' : 'above'), b: { k: 'num', v }, pct: 0 }) })
  return { rules, exits, used, rest: s }
}

export function read(text) {
  const brief = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600), low = brief.toLowerCase()
  const notes = [], cfg = { markets: findMarkets(brief), budget: 0 }
  if (!brief) return { config: null, notes, missed: [], error: 'Write what the agent should do, in your own words.' }
  let rest = low

  // budget and trade size
  let m
  const cut = (mm) => { rest = rest.replace(mm[0].toLowerCase(), ' ') }
  if ((m = new RegExp(String.raw`(?:budget|total|overall|limit|cap|spend(?:ing)?(?:\s+limit)?|with|using|allocate|start(?:ing)?\s+with)\s*(?:of|is|:|at|to|up\s+to|max(?:imum)?)?\s*(?:a\s+)?(?:total\s+)?(?:of\s+)?${MONEY}(?!\s*(?:per|each|a\s+(?:trade|buy)|every|of\s+[a-z]))`, 'i').exec(rest))) { cfg.budget = money(m[1] || m[2]); cut(m) }
  if ((m = new RegExp(String.raw`(?:never|don'?t|do\s+not)\s+(?:spend|use|risk)\s+more\s+than\s+${MONEY}`, 'i').exec(rest))) { cfg.budget = money(m[1] || m[2]); cut(m) }
  if ((m = new RegExp(String.raw`${MONEY}\s*(?:per|each|a|every)\s*(?:trade|buy|order|position|time)`, 'i').exec(rest))) { cfg.amount = money(m[1] || m[2]); cut(m) }
  if ((m = /(?:at\s+most|max(?:imum)?(?:\s+of)?|no\s+more\s+than|up\s+to)\s+(\d+)\s*%\s*(?:of\s+(?:the\s+|my\s+)?(?:budget|portfolio|money)\s*)?(?:per|in|on|a)\s*(?:one\s+|a\s+|any\s+|each\s+|single\s+)?(?:trade|market|position|stock|token|name)/i.exec(rest))) { cfg.maxPerMarket = +m[1] / 100; cut(m) }
  if (/\b(ask|check\s+with|ping|tell)\s+me\s+(?:first|before)|\bapprov|\bconfirm\s+(?:with\s+me|each|every)|\bmy\s+ok\b/.test(rest)) cfg.approve = true

  // basket: at least two "NN% TICKER" pairs
  const pairs = [...brief.matchAll(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*%\s*(?:in\s+|of\s+|into\s+)?(?:the\s+)?(\$?[A-Za-z&][A-Za-z0-9& ]{0,14}?)(?=\s*(?:,|and\b|\+|;|\.|$|rebalanc|with\b|\d))`, 'gi'))]
    .map((p) => [+p[1] / 100, findMarkets(p[2])[0], p[0]]).filter((p) => p[1])
  const everyRe = new RegExp(String.raw`\b(?:every|each|once\s+a|per)\s+(?:(\d+|two|three|four|six|twelve)\s+)?(hours?|days?|weeks?|months?|${Object.keys(DOW).join('|')})\b|\b(hourly|daily|weekly|monthly|biweekly)\b`)
  const ev = everyRe.exec(rest)
  const everyH = ev ? (ev[3] ? { hourly: 1, daily: 24, weekly: 168, biweekly: 336, monthly: 720 }[ev[3]] : ev[2] in DOW ? 168 : (ev[1] ? num(ev[1]) : 1) * (/^hour/.test(ev[2]) ? 1 : /^day/.test(ev[2]) ? 24 : /^week/.test(ev[2]) ? 168 : 720)) : null
  const at = /\bat\s+(\d{1,2})(?::00)?\s*(am|pm)?\s*(?:utc)?\b/.exec(rest)
  let conds

  if (pairs.length >= 2 && new Set(pairs.map((p) => p[1])).size >= 2) {
    cfg.kind = 'basket'; cfg.markets = [...new Set(pairs.map((p) => p[1]))]; cfg.weights = Object.fromEntries(pairs.map((p) => [p[1], p[0]]))
    cfg.every = [24, 168, 336, 720].includes(everyH) ? everyH : 168; if (!ev) notes.push('No rebalance schedule given, so it rebalances every week.')
    const d = /(?:drifts?|off|moves?|deviates?|away)\s*(?:by\s+|more\s+than\s+|over\s+)?(\d+(?:\.\d+)?)\s*(?:%|points?|pts)/.exec(rest); if (d) { cfg.drift = +d[1]; rest = rest.replace(d[0], ' ') }
    for (const p of pairs) rest = rest.replace(p[2].toLowerCase(), ' ')
    conds = conditions(rest.replace(everyRe, ' '), 'sell'); Object.assign(cfg, conds.exits)
  } else if (ev && /\b(buy|invest|put|add|accumulate|dca|stack|purchase|average\s+in)/.test(rest) && !/\bwhen\b|\bif\b|\bonce\b|\bwhenever\b/.test(rest.split(/\bsell\b|\bexit\b|\btake[\s-]*profit\b|\bstop\b/)[0].replace(/only\s+(if|when)/, ''))
    || (ev && /only\s+(if|when)/.test(rest))) {
    cfg.kind = 'dca'; cfg.every = [1, 6, 12, 24, 168, 336, 720].includes(everyH) ? everyH : everyH < 24 ? snap(everyH) : 168
    if (ev[2] in DOW) cfg.dow = DOW[ev[2]]
    if (at) { let h = +at[1] % 24; if (at[2] === 'pm' && h < 12) h += 12; if (at[2] === 'am' && h === 12) h = 0; cfg.at = h }
    const amt = new RegExp(String.raw`(?:buy|invest|put|add|accumulate|purchase|stack|dca)\s+(?:in\s+|me\s+)?${MONEY}`, 'i').exec(rest) || new RegExp(MONEY, 'i').exec(rest)
    if (amt && !cfg.amount) { cfg.amount = money(amt[1] || amt[2]); rest = rest.replace(amt[0], ' ') }
    if (!cfg.amount) { cfg.amount = 50; notes.push('No amount given, so each buy is $50.') }
    const [buyPart, ...sellParts] = rest.split(/\b(?:then\s+)?(?:sell|exit|close|get\s+out)\b/)
    const only = /only\s+(?:if|when)\s+(.*)$/.exec(buyPart); const cb = only ? conditions(only[1], 'buy') : { rules: [], exits: {}, used: [], rest: '' }
    const cs = conditions(sellParts.join(' ') + ' ' + (only ? buyPart.slice(0, only.index) : buyPart).replace(everyRe, ' '), 'sell')
    cfg.rules = { buy: cb.rules, sell: [] }; Object.assign(cfg, cb.exits, cs.exits); conds = { used: [...cb.used, ...cs.used] }
    if (!cfg.budget) { const runs = Math.max(1, Math.round(720 / cfg.every)); cfg.budget = Math.min(1e6, Math.max(cfg.amount, cfg.amount * runs * Math.max(1, cfg.markets.length))); notes.push(`No total budget given, so it is set to 30 days of buys: $${cfg.budget.toLocaleString('en-US')}.`) }
  } else {
    cfg.kind = 'rules'
    const parts = rest.split(/\b(?:and\s+then\s+|then\s+|and\s+)?(?=(?:sell|exit|close\s+(?:it|the|my)|get\s+out|take[\s-]*profit|stop[\s-]*loss|cut\s+(?:my\s+)?loss)\b)/)
    const buyText = parts.filter((p) => !/^(sell|exit|close|get\s+out|take[\s-]*profit|stop[\s-]*loss|cut)/.test(p)).join(' '), sellText = parts.filter((p) => /^(sell|exit|close|get\s+out|take[\s-]*profit|stop[\s-]*loss|cut)/.test(p)).join(' ')
    const cb = conditions(buyText, 'buy'), cs = conditions(sellText, 'sell')
    cfg.rules = { buy: cb.rules, sell: cs.rules }; Object.assign(cfg, cb.exits, cs.exits); conds = { used: [...cb.used, ...cs.used] }
    const amt = new RegExp(String.raw`(?:buy|invest|put|add|purchase)\s+${MONEY}`, 'i').exec(rest); if (amt && !cfg.amount) cfg.amount = money(amt[1] || amt[2])
  }
  if (!cfg.budget) { cfg.budget = DEFAULT_BUDGET; if (cfg.kind !== 'dca') notes.push(`No budget given, so it starts at $${DEFAULT_BUDGET.toLocaleString('en-US')}. Change it below.`) }
  if (cfg.amount > cfg.budget) cfg.budget = cfg.amount
  cfg.name = nameFor(cfg)

  let error = null
  if (!cfg.markets.length) error = `I could not find a market in that. Name one, for example NVDA, TSLA, SPY or gold. ${MARKETS.length} markets are listed under Markets.`
  else if (cfg.kind === 'rules' && !cfg.rules.buy.length) error = 'I found the market but not when to buy. Try "buy NVDA when it drops 5% in a day", "buy $50 of SPY every Monday" or "keep 60% SPY and 40% GLD".'
  else if (cfg.kind === 'rules' && !cfg.rules.sell.length && !cfg.stopLoss && !cfg.takeProfit && !cfg.maxHold) { cfg.takeProfit = 0.1; cfg.stopLoss = 0.08; notes.push('You did not say when to sell, so I added a 10% take profit and an 8% stop loss. Change or remove them below.') }
  return { config: error ? null : cfg, notes, error, brief }
}

function nameFor(cfg) {
  const m = cfg.markets.slice(0, 2).join(' + ') + (cfg.markets.length > 2 ? ' +' + (cfg.markets.length - 2) : '')
  if (cfg.kind === 'basket') return `${m} basket`
  if (cfg.kind === 'dca') return `${m} ${cfg.every === 24 ? 'daily' : cfg.every === 168 ? 'weekly' : cfg.every === 720 ? 'monthly' : 'steady'} buy`
  const r = cfg.rules.buy[0]
  const what = !r ? 'agent' : r.a.k === 'rsi' ? 'RSI' : r.b.k === 'high' ? 'breakout' : r.a.k === 'change' ? (r.b.v < 0 ? 'dip buyer' : 'momentum') : r.op.includes('below') ? 'dip buyer' : 'trend'
  return `${m} ${what}`
}

export const EXAMPLES = [
  'Buy $50 of NVDA every Monday at 14:00 UTC, with a budget of $1,000.',
  'Buy TSLA when it drops 5% in a day. Sell when it is up 8% or down 6%. Budget $2,000, at most 50% per trade.',
  'Keep 50% SPY, 30% QQQ and 20% gold. Rebalance every week or when a weight drifts 5 points. Budget $5,000.',
  'Buy chip stocks when they make a new 3-day high, sell when they fall 2% below their 48 hour average. Stop loss 7%.',
  'Buy $25 of bitcoin every day, only if it is below its 7 day average.',
  'Buy GME when RSI is below 30, sell when RSI is above 60. Hold at most 3 days.',
]
