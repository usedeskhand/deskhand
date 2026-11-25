// API test on a throwaway database: two wallets go through the whole product against a local server.
// Nothing here sends a transaction. Run: npm test
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const PORT = 5579, BASE = `http://localhost:${PORT}`, DATA = 'test/.data'
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true })
const warm = fs.existsSync('data/deskhand.db') // a local database with prices already in it: no need to load them
if (warm) for (const f of fs.readdirSync('data')) if (f.startsWith('deskhand.db')) fs.copyFileSync('data/' + f, `${DATA}/${f}`)
const srv = spawn('node', ['server.mjs'], { env: { ...process.env, PORT, DATA_DIR: DATA, ...(warm ? { NO_LOOP: '1' } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] })
let srvLog = ''; srv.stdout.on('data', (d) => (srvLog += d)); srv.stderr.on('data', (d) => (srvLog += d))
await new Promise((r) => setTimeout(r, 1500))
// a fresh clone loads 30 days of prices first (a few minutes, the price source is rate limited), then seeds the house agents
for (let i = 0; i < 120; i++) { const s = await fetch(BASE + '/api/stats').then((r) => r.json()).catch(() => ({})); if (s.listings >= 6) break; if (i === 0) console.log('waiting for prices and house agents…'); await new Promise((r) => setTimeout(r, 5000)) }
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name) } else { fail++; console.log('  FAIL', name, extra) } }

const wallet = () => { const acct = privateKeyToAccount(generatePrivateKey()); let cookie = ''
  const call = async (path, body) => { const r = await fetch(BASE + '/api' + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie }, body: body ? JSON.stringify(body) : undefined })
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, ...(await r.json().catch(() => ({}))) } }
  return { acct, call, cookie: () => cookie, async signIn() { const { message } = await call('/auth/nonce', { address: acct.address }); return call('/auth/verify', { address: acct.address, signature: await acct.signMessage({ message }) }) } } }

try {
  console.log('API')
  const A = wallet(), B = wallet()
  ok('stats', (await A.call('/stats')).markets === 22)
  ok('six house listings', (await A.call('/listings')).status === 200 && Object.keys(await A.call('/listings')).length >= 6)
  const d1 = await A.call('/draft', { brief: 'Buy $20 of NVDA every hour, with a budget of $200.' })
  ok('draft: hourly buy read', d1.config?.kind === 'dca' && d1.config.every === 1 && d1.config.amount === 20 && d1.sim?.curve?.length > 50, JSON.stringify(d1).slice(0, 200))
  const d2 = await A.call('/draft', { brief: 'make me rich' }); ok('draft: nonsense is refused with a reason', !!d2.error && !d2.config)
  const d3 = await A.call('/draft', { brief: 'Keep 70% SPY and 50% GLD' }); ok('draft: weights over 100% refused', d3.status === 400, JSON.stringify(d3).slice(0, 160))
  ok('create needs a session', (await A.call('/agents', { config: d1.config })).status === 401)
  ok('sign in A', (await A.signIn()).ok === true); ok('sign in B', (await B.signIn()).ok === true)
  ok('bad signature refused', (await (async () => { const C = wallet(), { message } = await C.call('/auth/nonce', { address: C.acct.address }); return C.call('/auth/verify', { address: C.acct.address, signature: await A.acct.signMessage({ message }) }) })()).status === 401)
  const a1 = await A.call('/agents', { config: d1.config, brief: d1.brief, mode: 'paper' }); ok('paper agent created', /^[a-f0-9]{10}$/.test(a1.id || ''), JSON.stringify(a1))
  const det = await A.call('/agents/' + a1.id); ok('first decision already logged, bought $20', det.decisions?.[0]?.action === 'buy' && Math.abs(det.decisions[0].usd - 20) < 0.01 && det.positions.length === 1, JSON.stringify(det.decisions?.[0]))
  ok('budget respected', Math.abs(det.cash - 180) < 0.01)
  ok('config hidden from other people', (await B.call('/agents/' + a1.id)).config === undefined && det.config !== undefined)
  ok('B cannot pause A’s agent', (await B.call(`/agents/${a1.id}/pause`, {})).status === 403)
  ok('pause / resume', (await A.call(`/agents/${a1.id}/pause`, {})).ok && (await A.call(`/agents/${a1.id}/resume`, {})).ok)
  // wallet mode: the buy becomes a request, the books do not move
  const a2 = await A.call('/agents', { config: d1.config, brief: d1.brief, mode: 'wallet' }); const meA = await A.call('/me')
  const ask = meA.approvals.find((x) => x.agent === a2.id); ok('wallet agent asks instead of trading', !!ask && ask.action === 'buy' && Math.abs(ask.usd - 20) < 0.01, JSON.stringify(meA.approvals))
  ok('wallet agent books untouched', Math.abs((await A.call('/agents/' + a2.id)).cash - 200) < 0.01)
  ok('B cannot settle A’s request', (await B.call(`/approvals/${ask.id}/settle`, { tx: '0x' + '1'.repeat(64) })).status === 403)
  ok('made-up transaction refused', [400, 409].includes((await A.call(`/approvals/${ask.id}/settle`, { tx: '0x' + '1'.repeat(64) })).status))
  ok('not a hash refused', (await A.call(`/approvals/${ask.id}/settle`, { tx: 'hello' })).status === 400)
  ok('skip', (await A.call(`/approvals/${ask.id}/skip`, {})).ok && !(await A.call('/me')).approvals.some((x) => x.id === ask.id))
  // marketplace
  ok('publish needs a real description', (await A.call('/listings', { agent: a1.id, pitch: 'short', price: 0 })).status === 400)
  ok('B cannot publish A’s agent', (await B.call('/listings', { agent: a1.id, pitch: 'An hourly NVDA buy for people who like small steps.', price: 0 })).status === 403)
  const l1 = await A.call('/listings', { agent: a1.id, pitch: 'An hourly NVDA buy for people who like small steps.', price: 0 }); ok('free listing published', /^[a-f0-9]{10}$/.test(l1.id || ''), JSON.stringify(l1))
  const ins = await B.call(`/listings/${l1.id}/install`, { budget: 500, mode: 'paper' }); ok('B installs a free listing with its own budget', !!ins.agent && (await B.call('/agents/' + ins.agent)).budget === 500, JSON.stringify(ins))
  ok('B cannot republish an installed agent', (await B.call('/listings', { agent: ins.agent, pitch: 'Copying someone else’s agent and selling it as mine.', price: 5 })).status === 400)
  ok('install counted, sale listed for A', (await A.call('/listings/' + l1.id)).installs === 1 && (await A.call('/me')).sales.length === 1)
  ok('edit price', (await A.call(`/listings/${l1.id}/edit`, { price: 12 })).ok && (await B.call('/listings/' + l1.id)).price === 12)
  const Cw = wallet(); await Cw.signIn()
  ok('paid listing needs a payment', (await Cw.call(`/listings/${l1.id}/install`, { budget: 300 })).status === 402)
  ok('fake payment refused', [400, 409].includes((await Cw.call(`/listings/${l1.id}/install`, { budget: 300, tx: '0x' + '2'.repeat(64) })).status))
  const d4 = await A.call('/draft', { brief: 'Buy $30 of NVDA every hour, with a budget of $300.' }); const a3 = await A.call('/agents', { config: d4.config, brief: d4.brief })
  ok('new version', (await A.call(`/listings/${l1.id}/versions`, { agent: a3.id, note: 'Bigger buys: $30 an hour.' })).version === 2)
  ok('same rules cannot be a new version', (await A.call(`/listings/${l1.id}/versions`, { agent: a3.id, note: 'Nothing changed at all.' })).status === 400)
  ok('retire hides it', (await A.call(`/listings/${l1.id}/edit`, { status: 'retired' })).ok && (await B.call('/listings/' + l1.id)).status === 404)
  ok('stop is final', (await A.call(`/agents/${a1.id}/stop`, {})).ok && (await A.call(`/agents/${a1.id}/resume`, {})).status === 400)
  const rt = await A.call('/route?symbol=NVDA&side=buy&amount=25'); ok('live route for a $25 NVDA buy' + (rt.status === 503 ? ' (routing service rate-limited, clear message)' : ''), (rt.expected > 0 && !!rt.venue) || (rt.status === 503 && /rate-limiting/.test(rt.error)), JSON.stringify(rt).slice(0, 200))
  ok('unknown market', (await A.call('/markets/ZZZZ')).status === 404)

} catch (e) { fail++; console.log('  CRASH', e.stack) }
srv.kill(); if (fail) console.log(srvLog.split('\n').filter((l) => /Error|at /.test(l)).slice(0, 12).join('\n'))
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
