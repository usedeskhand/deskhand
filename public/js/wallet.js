// The wallet side of Deskhand: sign-in by signature, and the two transactions a person can sign here:
// a swap an agent asked for (routed by LI.FI on Robinhood Chain) and a USDG payment to a creator.
// Everything is signed in the person's own wallet. This page never sees a key.
export const CHAIN = { id: 4663, hex: '0x1237', name: 'Robinhood Chain', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' }
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
export const me = { address: null }
export const eth = () => window.ethereum
const post = async (path, body) => { const r = await fetch('/api' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.'); return j }
const pad = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function loadMe() {
  const j = await fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}))
  me.address = j.address || null; document.dispatchEvent(new Event('dh-me')); return me
}
async function onChain() {
  const cur = await eth().request({ method: 'eth_chainId' }).catch(() => null); if (cur && parseInt(cur, 16) === CHAIN.id) return
  try { await eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hex }] }) }
  catch (err) { if (err.code !== 4902) throw err
    await eth().request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN.hex, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [CHAIN.explorer] }] }) }
}
export async function connect(toast = () => {}) {
  if (!eth()) { toast('No wallet found in this browser. Install MetaMask, Rabby or the Robinhood Wallet extension, then come back.'); return false }
  try {
    const [a] = await eth().request({ method: 'eth_requestAccounts' })
    if (!same(me.address, a)) {
      const { message } = await post('/auth/nonce', { address: a })
      const signature = await eth().request({ method: 'personal_sign', params: [message, a] })
      await post('/auth/verify', { address: a, signature })
    }
    await loadMe(); return !!me.address
  } catch (e) { toast(e.code === 4001 ? 'You closed the wallet window. Try again when you are ready.' : e.message || 'The wallet did not answer. Try again.'); return false }
}
export async function signOut() { await post('/auth/logout', {}).catch(() => {}); await loadMe() }

const call = (to, data) => eth().request({ method: 'eth_call', params: [{ to, data }, 'latest'] })
async function mined(hash, note) {
  for (let i = 0; i < 90; i++) { const r = await eth().request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null)
    if (r) { if (parseInt(r.status, 16) !== 1) throw new Error('That transaction failed on chain. Nothing was booked.'); return r } await sleep(2000) }
  throw new Error('The transaction is taking long to confirm. Check your wallet, then try again.')
}
const send = (tx) => eth().request({ method: 'eth_sendTransaction', params: [tx] })

// the trade one approval asks for: quote it for this wallet, check the quote is exactly that trade, allow the router, send
export async function swapFor(r, note = () => {}) {
  await onChain(); const from = me.address, buy = r.action === 'buy'
  const fromToken = buy ? USDG : r.token, toToken = buy ? r.token : USDG
  const amount = buy ? BigInt(Math.round(r.usd * 1e6)) : BigInt(Math.round(r.qty * 1e9)) * 10n ** BigInt(r.decimals - 9)
  // never more than the wallet holds
  const bal = BigInt(await call(fromToken, '0x70a08231' + pad(from)))
  if (bal < amount) { if (buy || bal === 0n) throw new Error(buy ? `Your wallet holds less than the ${r.usd.toFixed(2)} USDG this trade needs.` : `Your wallet holds no ${r.symbol} to sell.`) }
  // a sell of what the agent holds takes the whole balance when only rounding dust would stay behind
  const amt = bal < amount || (!buy && bal - amount < amount / 1000n) ? bal : amount
  note(`Asking for a route: ${buy ? `${r.usd.toFixed(2)} USDG to ${r.symbol}` : `${r.symbol} to USDG`}…`)
  const q = new URLSearchParams({ fromChain: CHAIN.id, toChain: CHAIN.id, fromToken, toToken, fromAmount: amt.toString(), fromAddress: from, slippage: '0.01' })
  const res = await fetch('https://li.quest/v1/quote?' + q), j = await res.json().catch(() => ({}))
  if (!res.ok || !j.transactionRequest) throw new Error(/No available quotes|not find/i.test(j.message || '') ? 'No route for that size right now. Skip it, or try again in a moment.' : 'The route did not come back. Try again.')
  const a = j.action, t = j.transactionRequest
  if (!same(a.fromToken.address, fromToken) || !same(a.toToken.address, toToken) || a.fromAmount !== amt.toString() || a.fromChainId !== CHAIN.id || a.toChainId !== CHAIN.id || !same(a.toAddress || from, from) || !same(t.from || from, from) || parseInt(t.chainId, 10) !== CHAIN.id)
    throw new Error('The route that came back is not the trade this agent asked for. Nothing was sent.')
  const out = Number(j.estimate.toAmount) / 10 ** a.toToken.decimals, min = Number(j.estimate.toAmountMin) / 10 ** a.toToken.decimals
  note(`Route: ${j.toolDetails?.name || j.tool}. Expected ${out.toFixed(6)} ${a.toToken.symbol}, at least ${min.toFixed(6)}.`)
  const spender = j.estimate.approvalAddress
  const allowance = BigInt(await call(fromToken, '0xdd62ed3e' + pad(from) + pad(spender)))
  if (allowance < amt) { note(`Step 1 of 2: allow the router to use exactly this amount of ${a.fromToken.symbol}. Confirm in your wallet.`)
    await mined(await send({ from, to: fromToken, data: '0x095ea7b3' + pad(spender) + pad(amt.toString(16)) }), note) }
  note(`${allowance < amt ? 'Step 2 of 2' : 'One step'}: sign the trade in your wallet.`)
  const hash = await send({ from, to: t.to, data: t.data, value: t.value || '0x0', ...(t.gasLimit ? { gas: t.gasLimit } : {}) })
  note('Sent. Waiting for the chain to confirm…'); await mined(hash, note); return hash
}

// pay a creator: a plain USDG transfer, wallet to wallet
export async function payCreator(to, price, say = () => {}) {
  await onChain(); const from = me.address, amt = BigInt(Math.round(price * 1e6))
  const bal = BigInt(await call(USDG, '0x70a08231' + pad(from)))
  if (bal < amt) throw new Error(`Your wallet holds less than the ${price.toFixed(2)} USDG this agent costs.`)
  say('Confirm in your wallet…'); const hash = await send({ from, to: USDG, data: '0xa9059cbb' + pad(to) + pad(amt.toString(16)) })
  say('Waiting for the chain…'); await mined(hash); return hash
}

// a reading of the live route for a buy, asked from this browser (no wallet needed); falls back to the server's reading
export async function routePreview(symbol, token, usd) {
  const q = new URLSearchParams({ fromChain: CHAIN.id, toChain: CHAIN.id, fromToken: USDG, toToken: token.address, fromAmount: String(Math.round(usd * 1e6)), fromAddress: me.address || '0x000000000000000000000000000000000000dEaD', slippage: '0.01' })
  const res = await fetch('https://li.quest/v1/quote?' + q).catch(() => null), j = res ? await res.json().catch(() => ({})) : {}
  if (res?.ok && j.estimate) { const e = j.estimate, d = 10 ** j.action.toToken.decimals
    return { venue: j.toolDetails?.name || j.tool, expected: Number(e.toAmount) / d, minimum: Number(e.toAmountMin) / d, fees: (e.feeCosts || []).reduce((s, f) => s + (+f.amountUSD || 0), 0), gas: (e.gasCosts || []).reduce((s, g) => s + (+g.amountUSD || 0), 0), at: new Date().toISOString() } }
  if (res && res.status !== 429 && /No available quotes|not find/i.test(j.message || '')) throw new Error(`No route for ${symbol} at that size right now.`)
  const r = await fetch(`/api/route?symbol=${symbol}&side=buy&amount=${usd}`), k = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(k.error || 'The route check did not answer. Try again in a moment.'); return k
}
