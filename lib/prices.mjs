// Hourly closes for every market. History comes from GeckoTerminal's hourly candles (one call per market, spaced out:
// the free tier answers 429 when hit faster); each new hour is read on chain from the pool itself at the top of the hour,
// with ETH and BTC checked against their Chainlink feed. Hours are unix hours (seconds / 3600).
import { createPublicClient, http, parseAbi, keccak256, encodeAbiParameters } from 'viem'
import { MARKETS } from './markets.mjs'
import { all, run, one, kv } from './db.mjs'

const GT = 'https://api.geckoterminal.com/api/v2/networks/robinhood'
const SPACING = 6500, HOURS = 24 * 30 + 72
const RPC = process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com'
const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951', MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const V3 = parseAbi(['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'])
const PM = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)'])
const FEED = parseAbi(['function latestRoundData() view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const hourNow = () => Math.floor(Date.now() / 3600e3)

const save = (symbol, hour, close, source) => run('INSERT INTO closes (symbol, hour, close, source) VALUES (?, ?, ?, ?) ON CONFLICT(symbol, hour) DO UPDATE SET close = excluded.close, source = excluded.source', symbol, hour, close, source)

// GeckoTerminal candles start at the hour; the close of the hour h candle is the price at h + 1, which is how we store it
async function candles(m, limit = 1000, before) {
  const q = new URLSearchParams({ aggregate: '1', currency: 'usd', token: m.address, limit: String(limit) })
  if (before) q.set('before_timestamp', String(before))
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${GT}/pools/${m.pool}/ohlcv/hour?${q}`, { headers: { accept: 'application/json' } })
    if (r.status === 429) { await sleep(20e3); continue }
    if (!r.ok) throw new Error(`GeckoTerminal ${r.status} for ${m.symbol}`)
    const j = await r.json()
    return (j?.data?.attributes?.ohlcv_list || []).filter((c) => c[0] % 3600 === 0 && c[4] > 0).map((c) => ({ hour: c[0] / 3600 + 1, close: +c[4] }))
  }
  throw new Error(`GeckoTerminal kept answering 429 for ${m.symbol}`)
}

// fill the last 33 days of every market, then any hole the hourly reads left
export async function backfill(log = console.log) {
  const end = hourNow()
  for (const m of MARKETS) {
    const have = one('SELECT COUNT(*) n FROM closes WHERE symbol = ? AND hour > ?', m.symbol, end - HOURS).n
    if (have >= 600) continue // GeckoTerminal skips hours without trades; the hourly chain reads fill the rest
    try { const cs = await candles(m); for (const c of cs) if (c.hour <= end) save(m.symbol, c.hour, c.close, 'gt'); log(`backfill ${m.symbol}: ${cs.length}`) }
    catch (e) { log(`backfill ${m.symbol}: ${e.message}`) }
    await sleep(SPACING)
  }
}

const client = createPublicClient({ transport: http(RPC, { retryCount: 2, timeout: 20e3 }) })
const Q96 = 2 ** 96
const priceOf = (sqrt, t0, dec) => { const p = (Number(sqrt) / Q96) ** 2; return t0 ? p * 10 ** (dec - 6) : 10 ** (dec - 6) / p }
const v4slot = (id) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [id, 6n]))

// read every pool at the current block: the close of the hour that just ended
export async function readHour(hour = hourNow()) {
  const res = await client.multicall({ multicallAddress: MULTICALL3, allowFailure: true, contracts: MARKETS.map((m) => m.kind === 'v3'
    ? { address: m.pool, abi: V3, functionName: 'slot0' }
    : { address: POOL_MANAGER, abi: PM, functionName: 'extsload', args: [v4slot(m.pool)] }) })
  const feeds = await client.multicall({ multicallAddress: MULTICALL3, allowFailure: true, contracts: MARKETS.filter((m) => m.feed).map((m) => ({ address: m.feed, abi: FEED, functionName: 'latestRoundData' })) })
  const feedOf = {}; MARKETS.filter((m) => m.feed).forEach((m, i) => { const f = feeds[i]; if (f.status === 'success' && f.result[1] > 0n) feedOf[m.symbol] = Number(f.result[1]) / 1e8 })
  const out = {}
  MARKETS.forEach((m, i) => {
    const r = res[i]; if (r.status !== 'success') return
    const sqrt = m.kind === 'v3' ? r.result[0] : BigInt(r.result) & ((1n << 160n) - 1n)
    if (!sqrt) return
    const p = priceOf(sqrt, m.t0, m.decimals)
    if (!(p > 0 && Number.isFinite(p))) return
    if (feedOf[m.symbol] && Math.abs(p / feedOf[m.symbol] - 1) > 0.02) return // pool off its feed: skip the hour rather than trade on it
    out[m.symbol] = p; save(m.symbol, hour, p, 'chain')
  })
  kv.set('lastRead', { hour, at: new Date().toISOString(), n: Object.keys(out).length })
  return out
}

// drop isolated bad prints: a close more than 8% away from its six neighbours while those neighbours agree within 5%
// (seen on 29/10 21:00 UTC, every market +15% for one hour in GeckoTerminal's USD candles). Idempotent, runs after each backfill.
export function scrub(log = () => {}) {
  let n = 0
  for (const m of MARKETS) {
    const rows = all('SELECT hour, close FROM closes WHERE symbol = ? ORDER BY hour', m.symbol)
    for (let i = 3; i < rows.length - 3; i++) {
      const nb = [rows[i - 3], rows[i - 2], rows[i - 1], rows[i + 1], rows[i + 2], rows[i + 3]].map((r) => r.close).sort((a, b) => a - b)
      const med = (nb[2] + nb[3]) / 2
      if (Math.abs(rows[i].close / med - 1) > 0.08 && nb[5] / nb[0] - 1 < 0.05) { run('DELETE FROM closes WHERE symbol = ? AND hour = ?', m.symbol, rows[i].hour); n++ }
    }
  }
  if (n) log(`scrub: ${n} bad prints removed`); return n
}

// closes of one market from hour a to b inclusive; a missing hour repeats the last known close (marked so the engine can tell)
export function series(symbol, a, b) {
  const rows = all('SELECT hour, close FROM closes WHERE symbol = ? AND hour BETWEEN ? AND ? ORDER BY hour', symbol, a - 200, b)
  const at = new Map(rows.map((r) => [r.hour, r.close])); const out = []; let last = null
  for (const r of rows) if (r.hour < a) last = r.close
  for (let h = a; h <= b; h++) { if (at.has(h)) last = at.get(h); out.push(last) }
  return out
}
export const lastClose = (symbol) => one('SELECT hour, close FROM closes WHERE symbol = ? ORDER BY hour DESC LIMIT 1', symbol)
export const latestHour = () => one('SELECT MAX(hour) h FROM closes')?.h || 0
