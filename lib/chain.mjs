// What the server reads from Robinhood Chain itself: the receipt of a trade a person approved, the payment for a listing,
// and a live route for a trade (LI.FI), so a simulation can show the venue, the fee and the expected fill before anything is signed.
import { createPublicClient, http, parseAbiItem, decodeEventLog, isHash } from 'viem'
import { USDG, BY_SYMBOL, CHAIN_ID } from './markets.mjs'

const RPC = process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com'
export const client = createPublicClient({ transport: http(RPC, { retryCount: 2, timeout: 20e3 }) })
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const err = (m, code = 400) => Object.assign(new Error(m), { code })
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase()

async function transfers(hash, from) {
  if (!isHash(hash)) throw err('That is not a transaction hash.')
  const r = await client.getTransactionReceipt({ hash }).catch(() => null)
  if (!r) throw err('That transaction is not confirmed yet. Give it a few seconds and try again.', 409)
  if (r.status !== 'success') throw err('That transaction failed on chain, so nothing was booked.')
  if (!same(r.from, from)) throw err('That transaction was sent by another wallet.')
  const out = []
  for (const l of r.logs) { try { const e = decodeEventLog({ abi: [TRANSFER], data: l.data, topics: l.topics }); out.push({ token: l.address.toLowerCase(), from: e.args.from.toLowerCase(), to: e.args.to.toLowerCase(), value: e.args.value }) } catch {} }
  return out
}
const sum = (ts, token, key, addr) => ts.filter((t) => same(t.token, token) && same(t[key], addr)).reduce((s, t) => s + t.value, 0n)

// the real fill of an approved trade: USDG that left (or reached) the wallet and tokens that reached (or left) it
export async function fillOf(hash, addr, symbol, action) {
  const m = BY_SYMBOL[symbol], ts = await transfers(hash, addr)
  const usdg = Number(action === 'buy' ? sum(ts, USDG, 'from', addr) - sum(ts, USDG, 'to', addr) : sum(ts, USDG, 'to', addr) - sum(ts, USDG, 'from', addr)) / 1e6
  const qty = Number(action === 'buy' ? sum(ts, m.address, 'to', addr) - sum(ts, m.address, 'from', addr) : sum(ts, m.address, 'from', addr) - sum(ts, m.address, 'to', addr)) / 10 ** m.decimals
  if (!(usdg > 0) || !(qty > 0)) throw err(`That transaction is not a ${action} of ${symbol} against USDG from your wallet.`)
  return { usd: usdg, qty }
}

// a listing is paid for with a plain USDG transfer from the buyer to the creator
export async function paymentOf(hash, from, to) {
  const ts = await transfers(hash, from)
  return Number(ts.filter((t) => same(t.token, USDG) && same(t.from, from) && same(t.to, to)).reduce((s, t) => s + t.value, 0n)) / 1e6
}

// a live route for one trade. Cached for 20 s: a quote is a reading, not a promise.
const cache = new Map()
export async function route(symbol, action, amount, from = '0x000000000000000000000000000000000000dEaD') {
  // amount: dollars for a buy, token quantity for a sell
  const m = BY_SYMBOL[symbol]; if (!m) throw err('Unknown market.', 404)
  if (!(amount > 0)) throw err('Nothing to route.')
  const key = `${symbol}${action}${amount.toPrecision(4)}`, hit = cache.get(key); if (hit && Date.now() - hit.t < 20e3) return hit.v
  const raw = action === 'buy' ? String(Math.round(amount * 1e6)) : String(BigInt(Math.round(amount * 1e9)) * 10n ** BigInt(m.decimals - 9))
  const q = new URLSearchParams({ fromChain: CHAIN_ID, toChain: CHAIN_ID, fromToken: action === 'buy' ? USDG : m.address, toToken: action === 'buy' ? m.address : USDG, fromAmount: raw, fromAddress: from, slippage: '0.01' })
  const r = await fetch('https://li.quest/v1/quote?' + q, { signal: AbortSignal.timeout(12e3) }).catch(() => null)
  const j = r ? await r.json().catch(() => null) : null
  if (r?.status === 429) throw err('The routing service is rate-limiting this server right now. Try again in a few minutes.', 503)
  if (!r?.ok || !j?.estimate) throw err(/No available quotes|not find/i.test(j?.message || '') ? `No route for ${symbol} at that size right now.` : 'The route check did not answer. Try again in a moment.', 502)
  const e = j.estimate, out = j.action.toToken, inn = j.action.fromToken
  const v = { venue: j.toolDetails?.name || j.tool, expected: Number(e.toAmount) / 10 ** out.decimals, minimum: Number(e.toAmountMin) / 10 ** out.decimals, inAmount: Number(e.fromAmount) / 10 ** inn.decimals,
    inSymbol: inn.symbol, outSymbol: out.symbol, fees: (e.feeCosts || []).reduce((s, f) => s + (+f.amountUSD || 0), 0), gas: (e.gasCosts || []).reduce((s, g) => s + (+g.amountUSD || 0), 0),
    slippage: 1, at: new Date().toISOString() }
  cache.set(key, { t: Date.now(), v }); if (cache.size > 200) cache.clear()
  return v
}
