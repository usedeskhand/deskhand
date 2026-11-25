// Deskhand app. One page, rendered from /api: the builder, the marketplace, one listing, one agent, the leaderboard, the markets and the desk.
import { CHAIN, eth, me, loadMe, connect, signOut, swapFor, payCreator, routePreview } from './wallet.js'

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const usd = (v) => v == null ? 'n/a' : (v < 0 ? '−' : '') + '$' + (Math.abs(v) >= 1000 ? Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : Math.abs(v) >= 1 || Math.abs(v) < 0.005 ? Math.abs(v).toFixed(2) : Math.abs(v).toFixed(4))
const pct = (v, d = 1) => v == null ? 'n/a' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`
const cls = (v) => (v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : '')
const when = (h) => new Date(h * 3600e3).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const tok = (s, name) => `<span class="dh-tok"><img src="/logos/${esc(s)}.png" alt="" loading="lazy">${esc(name || s)}</span>`
const toks = (l) => `<span class="dh-toks">${l.map((s) => `<img src="/logos/${esc(s)}.png" alt="${esc(s)}" title="${esc(s)}" loading="lazy">`).join('')}</span>`
const explorer = (tx) => `${CHAIN.explorer}/tx/${tx}`
const app = $('#app')
export function toast(t) { let el = $('.dh-toast'); if (!el) { el = document.createElement('div'); el.className = 'dh-toast'; document.body.append(el) } el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 5200) }
export async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.body ? 'POST' : 'GET', headers: opts.body ? { 'content-type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' })
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Try again.'), { status: r.status }); return j
}
const page = (html) => { app.innerHTML = `<div class="dh-wrap">${html}</div>`; window.scrollTo(0, 0) }
const head = (h1, p, right = '', crumb = '') => `${crumb ? `<div class="dh-crumb">${crumb}</div>` : ''}<div class="dh-head"><div><h1>${h1}</h1>${p ? `<p>${p}</p>` : ''}</div>${right ? `<div class="dh-row">${right}</div>` : ''}</div>`
const go = (href) => { history.pushState({}, '', href); route() }
const busy = async (btn, fn) => { const t = btn.textContent; btn.disabled = true; try { return await fn((s) => (btn.textContent = s)) } catch (e) { toast(e.code === 4001 ? 'You closed the wallet window. Nothing was sent.' : e.message || 'Something went wrong. Try again.') } finally { btn.disabled = false; btn.textContent = t } }
const need = async () => me.address || (await connect(toast))

// ---- charts ----
function chart(rows, base) {
  if (!rows || rows.length < 2) return '<div class="dh-empty">The chart starts after the first full hour.</div>'
  const w = 900, h = 240, vs = rows.flatMap((r) => [r[1], r[2]]), lo = Math.min(...vs, base), hi = Math.max(...vs, base), pad = (hi - lo) * 0.12 || 1
  const x = (i) => (i / (rows.length - 1)) * w, y = (v) => h - 8 - ((v - lo + pad) / (hi - lo + 2 * pad)) * (h - 16)
  const line = (k) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(r[k]).toFixed(1)}`).join('')
  return `<svg class="dh-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Agent value against holding"><line x1="0" x2="${w}" y1="${y(base)}" y2="${y(base)}" stroke="#cfdbe8" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/>
    <path d="${line(2)}" fill="none" stroke="#b9c1cc" stroke-width="1.6" vector-effect="non-scaling-stroke"/><path d="${line(1)}" fill="none" stroke="#0e172b" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="dh-row between" style="margin-top:.6rem"><div class="dh-legend"><span><i></i>Agent</span><span><i class="hold"></i>Holding the same tokens</span></div><div class="dh-legend"><span>${when(rows[0][0])}</span><span>${when(rows[rows.length - 1][0])} UTC</span></div></div>`
}
function spark(vals, up) {
  if (!vals || vals.length < 2) return ''
  const w = 300, h = 44, lo = Math.min(...vals), hi = Math.max(...vals), y = (v) => h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6)
  return `<svg class="dh-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="${vals.map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * w).toFixed(1)} ${y(v).toFixed(1)}`).join('')}" fill="none" stroke="${up ? '#128a4a' : '#c2334a'}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`
}
const stat = (label, value, sub = '', c = '') => `<div class="dh-stat"><span class="dh-label">${label}</span><b class="${c}">${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`
const planHtml = (plan) => `<dl class="dh-plan">${plan.map((l) => `<div><dt>${esc(l.t)}</dt><dd>${esc(l.d)}</dd></div>`).join('')}</dl>`
const permHtml = (p) => `<div class="dh-perm">${p.assets.map((a) => `<span class="dh-chip">${a === 'USDG' ? '' : `<img src="/logos/${a}.png" alt="">`}${a}</span>`).join('')}</div>
  <p class="dh-small dh-mute" style="margin:.8rem 0 0">May spend up to ${usd(p.budget)} in total${Number.isFinite(p.perTrade) && p.perTrade < p.budget ? `, ${usd(p.perTrade)} at most per trade` : ''}. ${p.sells ? 'May sell what it bought.' : 'Never sells.'} It cannot touch any other token, and it cannot withdraw.</p>`
const logHtml = (rows, withAgent) => rows.length ? `<div class="dh-log">${rows.map((d) => `<div><time>${when(d.hour)}</time><span class="act ${d.action}">${{ buy: 'Buy', sell: 'Sell', hold: 'Wait', ask: 'Ask' }[d.action]}</span><span class="dh-mono dh-small">${esc(d.symbol)}</span><span>${withAgent ? `<a href="/agents/${d.agent}" data-link>${esc(d.name)}</a>: ` : ''}${esc(d.reason)}${d.tx ? ` <a href="${explorer(d.tx)}" target="_blank" rel="noopener">Receipt</a>` : ''}</span></div>`).join('')}</div>` : '<div class="dh-empty">Nothing logged yet. The first line is written at the next full hour.</div>'
const simStats = (s) => `<div class="dh-stats">${stat('Agent, 30 days', pct(s.ret), `${usd(s.budget)} became ${usd(s.end)}`, cls(s.ret))}${stat('Holding instead', pct(s.holdRet), 'same tokens, bought day one', cls(s.holdRet))}${stat('Trades', s.buys + s.sells, `${s.buys} buys, ${s.sells} sells`)}${stat('Largest drop', '−' + s.drawdown.toFixed(1) + '%', 'from a high to the next low')}${stat('Costs', '$' + s.fees.toFixed(2), '0.4% counted on every trade')}</div>`

// ---- builder ----
let draft = null, examples = [], tokens = {}
async function builder() {
  const q = new URLSearchParams(location.search), start = q.get('brief') || sessionStorage.getItem('dh-brief') || ''
  if (!examples.length) ({ examples, tokens } = await api('/config'))
  page(`${head('Build an agent', 'Write what you want it to do. You will see the rules it becomes and how they did over the last 30 days before anything is switched on.')}
  <div class="dh-grid dh-2"><div class="dh-stack">
    <div class="dh-card"><label class="dh-field"><span class="dh-label">Your brief</span><textarea class="dh-area" id="brief" maxlength="600" placeholder="Buy $50 of NVDA every Monday, with a budget of $1,000.">${esc(start)}</textarea></label>
      <div class="dh-row between" style="margin-top:.9rem"><span class="dh-small dh-mute">Name the tokens, when to buy, when to sell, how much.</span><button class="dh-btn" id="read">Read my brief</button></div></div>
    <div class="dh-card is-wash"><div class="dh-label" style="margin-bottom:.7rem">Or start from one of these</div><div class="dh-examples">${examples.map((e) => `<button class="dh-example" type="button">${esc(e)}</button>`).join('')}</div></div>
  </div><div id="draft" class="dh-stack"><div class="dh-card"><div class="dh-empty">The rules and the simulation appear here.<br>Nothing is saved until you start the agent.</div></div></div></div>`)
  const read = async () => { const brief = $('#brief').value.trim(); if (!brief) return toast('Write what the agent should do first.'); sessionStorage.setItem('dh-brief', brief); await busy($('#read'), async (say) => { say('Reading…'); showDraft(await api('/draft', { body: { brief } }), brief) }) }
  $('#read').onclick = read
  $('#brief').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) read() })
  $$('.dh-example').forEach((b) => (b.onclick = () => { $('#brief').value = b.textContent; read() }))
  if (start) read()
}
function showDraft(r, brief) {
  const box = $('#draft')
  if (r.error) { draft = null; box.innerHTML = `<div class="dh-card"><div class="dh-note is-error">${esc(r.error)}</div></div>`; return }
  draft = { brief, config: r.config, mode: draft?.mode || (r.approve ? 'wallet' : 'paper') }
  const c = r.config, s = r.sim, pc = (v) => (v ? +(v * 100).toFixed(1) : '')
  box.innerHTML = `<div class="dh-card"><div class="dh-row between" style="margin-bottom:.9rem"><h2 style="margin:0">The rules</h2><span class="dh-chip">${{ rules: 'Rules', dca: 'Scheduled buy', basket: 'Basket' }[c.kind]}</span></div>
      ${planHtml(s.plan)}${r.notes.length ? `<div class="dh-note" style="margin-top:1rem">${r.notes.map(esc).join('<br>')}</div>` : ''}</div>
    <div class="dh-card"><h2>Limits</h2><div class="dh-fields">
      <label class="dh-field"><span class="dh-label">Name</span><input class="dh-input" data-k="name" maxlength="40" value="${esc(c.name)}"></label>
      <label class="dh-field"><span class="dh-label">Total budget, USD</span><input class="dh-input" data-k="budget" type="number" min="20" step="10" value="${c.budget}"></label>
      ${c.kind !== 'basket' ? `<label class="dh-field"><span class="dh-label">${c.kind === 'dca' ? 'Each buy, USD' : 'Each buy, USD (empty = all)'}</span><input class="dh-input" data-k="amount" type="number" min="5" step="5" value="${c.amount || ''}"></label>` : `<label class="dh-field"><span class="dh-label">Rebalance when a weight is off by, points</span><input class="dh-input" data-k="drift" type="number" min="0" max="50" step="1" value="${c.drift || ''}"></label>`}
      ${c.kind === 'rules' ? `<label class="dh-field"><span class="dh-label">Most in one market, %</span><input class="dh-input" data-k="maxPerMarket" data-pc type="number" min="5" max="100" step="5" value="${pc(c.maxPerMarket)}"></label>` : ''}
      <label class="dh-field"><span class="dh-label">Take profit, % (empty = none)</span><input class="dh-input" data-k="takeProfit" data-pc type="number" min="0" step="1" value="${pc(c.takeProfit)}"></label>
      <label class="dh-field"><span class="dh-label">Stop loss, % (empty = none)</span><input class="dh-input" data-k="stopLoss" data-pc type="number" min="0" max="90" step="1" value="${pc(c.stopLoss)}"></label>
    </div></div>
    <div class="dh-card"><div class="dh-row between" style="margin-bottom:1rem"><h2 style="margin:0">Simulation on the last 30 days</h2><span class="dh-small dh-mute">Real hourly prices, ${when(s.from)} to ${when(s.to)} UTC</span></div>
      ${s.missing.length ? `<div class="dh-note" style="margin-bottom:1rem">${esc(s.missing.join(', '))} ${s.missing.length > 1 ? 'have' : 'has'} gaps in the first week of the window, so the simulation starts late on ${s.missing.length > 1 ? 'them' : 'it'}.</div>` : ''}
      ${simStats(s)}<div style="margin-top:1.2rem">${chart(s.curve, s.budget)}</div>
      <details style="margin-top:1.1rem"><summary class="dh-small" style="cursor:pointer">Every simulated trade (${s.log.length}${s.buys + s.sells > s.log.length ? ' most recent' : ''})</summary><div style="margin-top:.6rem">${logHtml(s.log)}</div></details>
      <div class="dh-row between" style="margin-top:1.1rem;border-top:1px solid var(--wash);padding-top:1rem"><span class="dh-small dh-mute">Check the real route for the first trade, right now.</span><button class="dh-btn is-quiet is-small" id="route">Check a live route</button></div><div id="routeOut"></div></div>
    <div class="dh-card"><h2>What this agent may touch</h2>${permHtml(s.permissions)}</div>
    <div class="dh-card is-dark"><h2>Start it</h2>
      <div class="dh-seg" id="mode"><button data-m="paper" class="${draft.mode === 'paper' ? 'on' : ''}">Paper mode</button><button data-m="wallet" class="${draft.mode === 'wallet' ? 'on' : ''}">Wallet mode</button></div>
      <p class="dh-small" id="modeTxt" style="color:#cfdbe8;margin:.9rem 0 1.1rem"></p>
      <div class="dh-row"><button class="dh-btn is-light" id="start">Start the agent</button><span class="dh-small" style="color:#97a4b7">Checks the market every hour. Pause or stop it whenever you like.</span></div></div>`
  const modeTxt = () => { $('#modeTxt').textContent = draft.mode === 'paper' ? 'Simulated money on live prices. Nothing moves, and you can watch it work before trusting it.' : 'Each trade comes to you as a request with its route and expected fill. You sign it from your own wallet, and the receipt is kept with the reason.' }
  modeTxt(); $$('#mode button').forEach((b) => (b.onclick = () => { draft.mode = b.dataset.m; $$('#mode button').forEach((x) => x.classList.toggle('on', x === b)); modeTxt() }))
  let t; $$('[data-k]', box).forEach((i) => i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
    const edits = {}; $$('[data-k]', box).forEach((f) => { const v = f.value.trim(); edits[f.dataset.k] = f.dataset.k === 'name' ? v : f.hasAttribute('data-pc') ? (+v || 0) / 100 : +v || 0 })
    if (c.kind === 'dca' && !edits.amount) return
    try { const focus = document.activeElement?.dataset?.k, pos = document.activeElement?.selectionStart; showDraft(await api('/draft', { body: { brief, edits } }), brief)
      const f = focus && $(`[data-k="${focus}"]`, $('#draft')); if (f) { f.focus(); if (f.type === 'text' && pos != null) f.setSelectionRange(pos, pos) } } catch (e) { toast(e.message) }
  }, 650) }))
  $('#route').onclick = () => busy($('#route'), async (say) => { say('Asking…')
    const first = s.log.length ? s.log[s.log.length - 1] : null, sym = first?.symbol || c.markets[0], amt = Math.round(first?.action === 'buy' ? first.usd : c.amount || Math.min(c.budget, 100))
    const q = await routePreview(sym, tokens[sym], amt)
    $('#routeOut').innerHTML = `<div class="dh-note is-ok" style="margin-top:.9rem">Buying ${usd(amt)} of ${sym} right now would go through <b>${esc(q.venue)}</b> and fill about <b>${q.expected.toFixed(6)} ${sym}</b> (at least ${q.minimum.toFixed(6)} with 1% slippage). Route fees ${usd(q.fees)}, network fee about ${usd(q.gas)}. Read ${new Date(q.at).toLocaleTimeString()}.</div>` })
  $('#start').onclick = () => busy($('#start'), async (say) => { if (!(await need())) return; say('Starting…')
    const { id } = await api('/agents', { body: { config: draft.config, brief: draft.brief, mode: draft.mode } }); sessionStorage.removeItem('dh-brief'); toast('Your agent is running. Its first decision is already in the log.'); go('/agents/' + id) })
}

// ---- marketplace ----
let mk = { kind: 'All', sort: 'installs' }
async function market() {
  const all = await api('/listings')
  const draw = () => {
    const l = all.filter((x) => mk.kind === 'All' || x.kind === mk.kind).sort((a, b) => mk.sort === 'ret' ? b.ret - a.ret : mk.sort === 'new' ? b.updated.localeCompare(a.updated) : b.installs - a.installs || b.ret - a.ret)
    $('#list').innerHTML = l.length ? l.map((x) => `<a class="dh-listing" href="/market/${x.id}" data-link><div class="dh-row between">${toks(x.markets)}<span class="dh-price">${x.price ? usd(x.price) : 'Free'}</span></div>
      <div><h3>${esc(x.name)}</h3><div class="dh-small dh-mute" style="margin-top:.25rem">${esc(x.kind)} by ${esc(x.by)}, v${x.version}</div></div><p>${esc(x.pitch)}</p>${spark(x.spark, x.ret >= 0)}
      <div class="foot"><span>30 days <b class="${cls(x.ret)}">${pct(x.ret)}</b> · holding ${pct(x.holdRet)}</span><span>${x.installs ? `${x.installs} install${x.installs === 1 ? '' : 's'}` : `${x.trades} trades in replay`}</span></div></a>`).join('') : '<div class="dh-empty" style="grid-column:1/-1">No listing of that kind yet. Publish the first one from one of your agents.</div>'
  }
  page(`${head('Marketplace', 'Agents written by other people. Each one shows its rules, its permissions and its 30-day simulation. You install your own copy, with your own budget.', '<a class="dh-btn is-ghost" href="/desk" data-link>Publish an agent</a>')}
    <div class="dh-filters"><div class="dh-seg" id="kind">${['All', 'Rules', 'Scheduled buy', 'Basket'].map((k) => `<button class="${mk.kind === k ? 'on' : ''}">${k}</button>`).join('')}</div>
    <div class="dh-seg" id="sort">${[['installs', 'Most installed'], ['ret', 'Best 30 days'], ['new', 'Newest']].map(([k, t]) => `<button data-s="${k}" class="${mk.sort === k ? 'on' : ''}">${t}</button>`).join('')}</div></div><div class="dh-list" id="list"></div>`)
  draw()
  $$('#kind button').forEach((b) => (b.onclick = () => { mk.kind = b.textContent; $$('#kind button').forEach((x) => x.classList.toggle('on', x === b)); draw() }))
  $$('#sort button').forEach((b) => (b.onclick = () => { mk.sort = b.dataset.s; $$('#sort button').forEach((x) => x.classList.toggle('on', x === b)); draw() }))
}

async function listing(id) {
  const l = await api('/listings/' + id), s = l.sim
  page(`${head(esc(l.name), esc(l.pitch), '', `<a href="/market" data-link>Marketplace</a><span>/</span><span>${esc(l.kind)} by ${esc(l.by)}</span>`)}
  <div class="dh-grid dh-21"><div class="dh-stack">
    <div class="dh-card"><div class="dh-row between" style="margin-bottom:1rem"><h2 style="margin:0">Simulation on the last 30 days</h2><span class="dh-small dh-mute">Version ${l.version}, with its own ${usd(s.budget)} budget</span></div>${simStats(s)}<div style="margin-top:1.2rem">${chart(s.curve, s.budget)}</div>
      <details style="margin-top:1.1rem"><summary class="dh-small" style="cursor:pointer">Every simulated trade</summary><div style="margin-top:.6rem">${logHtml(s.log)}</div></details></div>
    <div class="dh-card"><h2>The rules</h2>${l.brief ? `<p class="dh-small dh-mute" style="margin:0 0 1rem">Written as: “${esc(l.brief)}”</p>` : ''}${planHtml(l.plan)}</div>
    <div class="dh-card"><h2>Versions</h2><div class="dh-log">${l.versions.map((v) => `<div style="grid-template-columns:4rem 8rem 1fr"><span class="act">v${v.version}</span><time>${day(v.created)}</time><span>${esc(v.note)}</span></div>`).join('')}</div></div>
    ${l.mine ? `<div class="dh-card"><h2>Your listing</h2><div class="dh-fields"><label class="dh-field"><span class="dh-label">Price, USDG (0 = free)</span><input class="dh-input" id="ePrice" type="number" min="0" step="1" value="${l.price}"></label>
      <label class="dh-field" style="grid-column:1/-1"><span class="dh-label">Description</span><textarea class="dh-area" id="ePitch" style="min-height:5rem;font-size:.95rem" maxlength="280">${esc(l.pitch)}</textarea></label></div>
      <div class="dh-row" style="margin-top:1rem"><button class="dh-btn" id="eSave">Save</button><button class="dh-btn is-quiet" id="eRetire">${l.status === 'live' ? 'Retire the listing' : 'Put it back on sale'}</button></div>
      <h3 style="margin-top:1.6rem">Sales</h3>${l.sales.length ? `<div class="dh-scroll"><table class="dh-table"><thead><tr><th>Date</th><th>Buyer</th><th>Version</th><th class="num">Paid</th><th>Payment</th></tr></thead><tbody>${l.sales.map((x) => `<tr><td>${day(x.created)}</td><td class="dh-mono dh-small">${esc(x.addr)}</td><td>v${x.version}</td><td class="num">${x.paid ? usd(x.paid) : 'Free'}</td><td>${x.tx ? `<a href="${explorer(x.tx)}" target="_blank" rel="noopener">Transaction</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dh-small dh-mute" style="margin:0">No install yet.</p>'}</div>` : ''}
  </div><div class="dh-stack">
    <div class="dh-card is-dark"><div class="dh-row between"><span class="dh-label">Price</span><span class="dh-label">${l.installs ? `${l.installs} install${l.installs === 1 ? '' : 's'}` : `v${l.version} · ${esc(l.kind)}`}</span></div>
      <div style="font-size:2rem;font-weight:600;letter-spacing:-.02em;margin:.4rem 0 1rem">${l.price ? usd(l.price) + ' <span style="font-size:.9rem;font-weight:400;color:#97a4b7">USDG, once</span>' : 'Free'}</div>
      <label class="dh-field"><span class="dh-label">Your budget, USD</span><input class="dh-input" id="iBudget" type="number" min="20" step="10" value="${l.budget}"></label>
      <div class="dh-seg" id="iMode" style="margin-top:.9rem"><button data-m="paper" class="on">Paper mode</button><button data-m="wallet">Wallet mode</button></div>
      <button class="dh-btn is-light" id="install" style="width:100%;margin-top:1rem">${l.price && !l.mine ? `Pay ${usd(l.price)} and install` : 'Install my copy'}</button>
      <p class="dh-small" style="color:#97a4b7;margin:.8rem 0 0">${l.price && !l.mine ? `The payment goes straight from your wallet to the creator${l.creator ? ` (${l.creator.slice(0, 6)}…${l.creator.slice(-4)})` : ''}. Deskhand takes no cut.` : 'You get your own copy with the budget above. The creator never sees or controls it.'}</p>
      ${l.installed ? `<a class="dh-btn is-quiet is-small" style="margin-top:.9rem;color:#fff;border-color:#33415a" href="/agents/${l.installed}" data-link>Open the copy you already run</a>` : ''}</div>
    <div class="dh-card"><h2>What it may touch</h2>${permHtml(l.permissions)}</div>
    ${l.brief ? `<div class="dh-card"><h3>Make it yours</h3><p class="dh-small dh-mute" style="margin:0 0 .9rem">Open this brief in the builder, change a number or a token, and run your own version.</p><a class="dh-btn is-ghost is-small" href="/app?brief=${encodeURIComponent(l.brief)}" data-link>Open in the builder</a></div>` : ''}
    <div class="dh-card is-wash"><h3>Before you install</h3><p class="dh-small dh-mute" style="margin:0">The simulation replays one month that already happened. Read the rules, check the largest drop, and start with a budget you can afford to see fall.</p></div>
  </div></div>`)
  let mode = 'paper'; $$('#iMode button').forEach((b) => (b.onclick = () => { mode = b.dataset.m; $$('#iMode button').forEach((x) => x.classList.toggle('on', x === b)) }))
  $('#install').onclick = () => busy($('#install'), async (say) => { if (!(await need())) return; const body = { budget: +$('#iBudget').value, mode }
    if (l.price && !l.mine && l.creator) { try { say('Installing…'); const r0 = await api(`/listings/${id}/install`, { body }); toast('Installed.'); return go('/agents/' + r0.agent) } catch (e) { if (e.status !== 402) throw e }
      body.tx = await payCreator(l.creator, l.price, say) }
    say('Installing…'); let r, n = 0
    for (;;) { try { r = await api(`/listings/${id}/install`, { body }); break } catch (e) { if (e.status === 409 && n++ < 10) { await new Promise((z) => setTimeout(z, 2500)); continue } throw e } }
    toast('Installed. Your copy is running with your budget.'); go('/agents/' + r.agent) })
  if (l.mine) { $('#eSave').onclick = () => busy($('#eSave'), async () => { await api(`/listings/${id}/edit`, { body: { price: +$('#ePrice').value, pitch: $('#ePitch').value } }); toast('Saved.'); listing(id) })
    $('#eRetire').onclick = () => busy($('#eRetire'), async () => { await api(`/listings/${id}/edit`, { body: { status: l.status === 'live' ? 'retired' : 'live' } }); listing(id) }) }
}

// ---- one agent ----
async function agent(id) {
  const a = await api('/agents/' + id), meData = a.mine ? await api('/me') : null, asks = a.mine ? meData.approvals.filter((x) => x.agent === id) : []
  const myListing = a.mine && a.listing ? meData.listings.find((l) => l.id === a.listing) : null
  page(`${head(esc(a.name), `${esc(a.kind)} by ${esc(a.by)}, ${a.mode === 'wallet' ? 'wallet mode (every trade signed by its owner)' : 'paper mode (simulated money, live prices)'}. Running for ${a.hours} hour${a.hours === 1 ? '' : 's'}.`,
    `<span class="dh-status ${a.status}">${a.status}</span>${a.mine && a.status !== 'stopped' ? `<button class="dh-btn is-ghost is-small" id="pause">${a.status === 'live' ? 'Pause' : 'Resume'}</button><button class="dh-btn is-quiet is-small" id="stop">Stop for good</button>` : ''}`,
    `<a href="/board" data-link>Leaderboard</a><span>/</span><span>${toks(a.markets)}</span>`)}
  ${asks.length ? `<div class="dh-stack" style="margin-bottom:1.25rem">${asks.map(askHtml).join('')}</div>` : ''}
  <div class="dh-stats" style="margin-bottom:1.25rem">${stat('Value', usd(a.value), `started with ${usd(a.budget)}`)}${stat('Return', pct(a.ret, 2), '', cls(a.ret))}${stat('Holding instead', pct(a.holdRet, 2), '', cls(a.holdRet))}${stat('Trades', a.trades)}${stat('Unspent', usd(a.cash), 'of the budget')}</div>
  <div class="dh-grid dh-21"><div class="dh-stack">
    <div class="dh-card"><h2>Value since it started</h2>${chart(a.curve, a.budget)}</div>
    <div class="dh-card"><h2>Decision log</h2>${logHtml(a.decisions)}</div>
  </div><div class="dh-stack">
    <div class="dh-card"><h2>Holding now</h2>${a.positions.length ? `<table class="dh-table"><tbody>${a.positions.map((p) => `<tr><td>${tok(p.symbol)}</td><td class="num">${usd(p.value)}<br><span class="${cls(p.price / p.entry - 1)}">${pct((p.price / p.entry - 1) * 100)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="dh-small dh-mute" style="margin:0">Nothing. The whole budget is unspent.</p>'}</div>
    <div class="dh-card"><h2>The rules</h2>${a.brief ? `<p class="dh-small dh-mute" style="margin:0 0 1rem">Written as: “${esc(a.brief)}”</p>` : ''}${planHtml(a.plan)}</div>
    <div class="dh-card"><h2>What it may touch</h2>${permHtml(a.permissions)}</div>
    ${a.receipts.length ? `<div class="dh-card"><h2>Receipts</h2><div class="dh-log">${a.receipts.map((r) => `<div style="grid-template-columns:1fr auto"><span>${r.action === 'buy' ? 'Bought' : 'Sold'} ${r.qty.toFixed(5)} ${r.symbol} for ${usd(r.usd)}</span><a href="${explorer(r.tx)}" target="_blank" rel="noopener">Transaction</a></div>`).join('')}</div></div>` : ''}
    ${a.mine ? (myListing || (a.listing && !myListing) ? `<div class="dh-card is-wash"><h3>${myListing ? 'Published' : 'Installed from the marketplace'}</h3><p class="dh-small dh-mute" style="margin:0 0 .9rem">${myListing ? `This agent is listing “${esc(myListing.name)}”, version ${a.version}.` : `Version ${a.version} of a listing.`}</p><a class="dh-btn is-ghost is-small" href="/market/${a.listing}" data-link>Open the listing</a></div>`
      : `<div class="dh-card is-wash"><h3>Publish it</h3><p class="dh-small dh-mute" style="margin:0 0 .9rem">List these rules on the marketplace. Buyers install their own copy, and you set the price.</p>
        <label class="dh-field"><span class="dh-label">What it does and who it is for</span><textarea class="dh-area" id="pPitch" maxlength="280" style="min-height:5.5rem;font-size:.92rem" placeholder="A weekly buy of the two chip names, for people who want exposure without watching a chart."></textarea></label>
        <label class="dh-field" style="margin-top:.8rem"><span class="dh-label">Price, USDG (0 = free)</span><input class="dh-input" id="pPrice" type="number" min="0" step="1" value="0"></label>
        ${meData.listings.filter((l) => l.status === 'live').length ? `<label class="dh-field" style="margin-top:.8rem"><span class="dh-label">Or as a new version of</span><select class="dh-select" id="pOf"><option value="">A new listing</option>${meData.listings.filter((l) => l.status === 'live').map((l) => `<option value="${l.id}">${esc(l.name)} (v${l.version})</option>`).join('')}</select></label>` : ''}
        <button class="dh-btn" id="publish" style="margin-top:1rem">Publish</button></div>`) : `<div class="dh-card is-wash"><h3>Want the same thing?</h3><p class="dh-small dh-mute" style="margin:0 0 .9rem">${a.listing ? 'This agent is on the marketplace. Install your own copy with your own budget.' : 'Write your own version in the builder. It takes one sentence.'}</p><a class="dh-btn is-small" href="${a.listing ? '/market/' + a.listing : '/app'}" data-link>${a.listing ? 'Open the listing' : 'Open the builder'}</a></div>`}
  </div></div>`)
  bindAsks(() => agent(id))
  if (a.mine && a.status !== 'stopped') {
    $('#pause').onclick = () => busy($('#pause'), async () => { await api(`/agents/${id}/${a.status === 'live' ? 'pause' : 'resume'}`, { body: {} }); agent(id) })
    $('#stop').onclick = () => { if (confirm('Stop this agent for good? It keeps its history but will never trade again.')) busy($('#stop'), async () => { await api(`/agents/${id}/stop`, { body: {} }); agent(id) }) }
  }
  if ($('#publish')) $('#publish').onclick = () => busy($('#publish'), async () => { const of = $('#pOf')?.value
    if (of) { await api(`/listings/${of}/versions`, { body: { agent: id, note: $('#pPitch').value } }); toast('New version published.'); return go('/market/' + of) }
    const r = await api('/listings', { body: { agent: id, pitch: $('#pPitch').value, price: +$('#pPrice').value } }); toast('Published. It is on the marketplace now.'); go('/market/' + r.id) })
}

// ---- approvals: an agent in wallet mode asks, the person signs ----
const askHtml = (r) => `<div class="dh-approval" data-ask="${r.id}"><div class="dh-row between"><b>${esc(r.name)} asks to ${r.action} ${usd(r.usd)} of ${esc(r.symbol)}</b><span class="dh-label">expires ${when(r.expires / 3600)} UTC</span></div>
  <div class="dh-small">${esc(r.reason)}</div><div class="dh-steps" hidden></div>
  <div class="dh-row"><button class="dh-btn is-small" data-do="approve">Review and sign</button><button class="dh-btn is-quiet is-small" data-do="skip">Skip this one</button></div></div>`
function bindAsks(refresh) {
  $$('[data-ask]').forEach((el) => { const id = el.dataset.ask
    $('[data-do="skip"]', el).onclick = (e) => busy(e.target, async () => { await api(`/approvals/${id}/skip`, { body: {} }); toast('Skipped. The agent will ask again if the rule still holds next hour.'); refresh() })
    $('[data-do="approve"]', el).onclick = (e) => busy(e.target, async (say) => { if (!(await need())) return
      const r = (await api('/me')).approvals.find((x) => x.id === id); if (!r) { toast('That request is gone.'); return refresh() }
      const steps = $('.dh-steps', el); steps.hidden = false; const note = (t) => { steps.textContent += (steps.textContent ? '\n' : '') + t; say('Working…') }
      const hash = await swapFor(r, note); note('Confirmed. Booking the real fill…'); let n = 0
      for (;;) { try { const f = await api(`/approvals/${id}/settle`, { body: { tx: hash } }); toast(`Done: ${r.action === 'buy' ? 'bought' : 'sold'} ${f.qty.toFixed(5)} ${r.symbol} for ${usd(f.usd)}.`); break } catch (err) { if (err.status === 409 && n++ < 12) { await new Promise((z) => setTimeout(z, 2500)); continue } throw err } }
      refresh() }) })
}

// ---- leaderboard, markets ----
async function board() {
  const [rows, st, act] = await Promise.all([api('/board'), api('/stats'), api('/activity?limit=30')])
  page(`${head('Leaderboard', 'Every agent running on Deskhand, ranked by return since it started. Paper and wallet agents are marked, and each one is compared with simply holding its tokens.', '<a class="dh-btn" href="/app" data-link>Build an agent</a>')}
    <div class="dh-stats" style="margin-bottom:1.25rem">${stat('Agents running', st.agents)}${stat('Decisions logged', st.decisions.toLocaleString('en-US'))}${stat('Trades', st.trades.toLocaleString('en-US'))}${stat('Listings', st.listings)}${stat('Last price read', when(st.lastHour) + ' UTC')}</div>
    <div class="dh-card"><div class="dh-scroll"><table class="dh-table"><thead><tr><th>#</th><th>Agent</th><th>Kind</th><th>Markets</th><th>Mode</th><th class="num">Return</th><th class="num">Holding</th><th class="num">Trades</th><th class="num">Hours</th></tr></thead>
    <tbody>${rows.map((a, i) => `<tr data-go="/agents/${a.id}"><td class="dh-mono dh-small">${i + 1}</td><td><b>${esc(a.name)}</b><div class="dh-small dh-mute">${esc(a.by)}</div></td><td>${esc(a.kind)}</td><td>${toks(a.markets)}</td><td><span class="dh-status ${a.status}">${a.mode}</span></td><td class="num ${cls(a.ret)}">${pct(a.ret, 2)}</td><td class="num ${cls(a.holdRet)}">${pct(a.holdRet, 2)}</td><td class="num">${a.trades}</td><td class="num">${a.hours}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="dh-card" style="margin-top:1.25rem"><h2>Latest decisions</h2>${logHtml(act, true)}</div>`)
}
// ---- live clock: prices are read two minutes after every hour ----
const nextRead = () => { const n = Date.now(), h = 3600e3; let t = Math.floor(n / h) * h + 120e3; if (t <= n) t += h; return t }
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
function liveClock(el, lastHour, onTick) {
  clearInterval(liveClock.t); const draw = () => { if (!document.body.contains(el)) return clearInterval(liveClock.t); const left = nextRead() - Date.now()
    el.innerHTML = `<span class="dh-live"></span>Live on chain · last read ${new Date(lastHour * 3600e3).toISOString().slice(11, 16)} UTC · next read in <b>${mmss(left)}</b>`
    if (left < 1500 && onTick) setTimeout(onTick, 4000) }
  draw(); liveClock.t = setInterval(draw, 1000)
}
const mkt = (m) => `<span class="dh-mkt"><img src="/logos/${esc(m.symbol)}.png" alt="" loading="lazy"><span><b>${esc(m.name)}</b><small>${esc(m.symbol)}${m.type === 'crypto' ? ' · crypto' : ' · stock token'}</small></span></span>`
const range = (m) => { const lo = m.low7d, hi = m.high7d, p = hi > lo ? (m.price - lo) / (hi - lo) : 0.5
  return `<div class="dh-range" title="7-day low ${usd(lo)}, high ${usd(hi)}"><i style="left:${(p * 100).toFixed(1)}%"></i></div><div class="dh-range-l"><span>${usd(lo)}</span><span>${usd(hi)}</span></div>` }
const briefFor = (s) => `/app?brief=${encodeURIComponent(`Buy $50 of ${s} every Monday at 14:00 UTC, with a budget of $1,000.`)}`
let mkState = { sort: 'change24h', dir: -1, type: 'all', q: '' }
async function markets() {
  const rows = await api('/markets'), st = await api('/stats')
  const ok = rows.filter((m) => m.price != null), by = (k) => ok.slice().sort((a, b) => (b[k] ?? -1e9) - (a[k] ?? -1e9))
  const up = by('change24h')[0], down = by('change24h').at(-1), wk = by('change7d')[0], busy = by('decisions24h')[0]
  const mover = (label, m, v, sub) => `<a class="dh-mover" href="/markets/${m.symbol}" data-link><div class="dh-row between"><span class="dh-label">${label}</span><img src="/logos/${m.symbol}.png" alt=""></div>
    <div class="dh-mover-v ${cls(v)}">${pct(v, 2)}</div><div class="dh-small dh-mute">${esc(m.name)} · ${usd(m.price)}</div>${spark(m.week.filter((x) => x != null), (m.change7d || 0) >= 0)}<div class="dh-small dh-mute">${sub}</div></a>`
  page(`${head('Markets', '20 stock tokens plus bitcoin and ether on Robinhood Chain, each read from its USDG pool every hour. Put an agent on any of them in one sentence.', '<span class="dh-clock" id="clock"></span>')}
    <div class="dh-movers">${mover('Top gainer · 24h', up, up.change24h, 'Strongest move of the last day')}${mover('Top loser · 24h', down, down.change24h, 'Where dip buyers look first')}${mover('Best week', wk, wk.change7d, '7-day change')}${mover('Most watched by agents', busy, busy.change24h, `${busy.decisions24h} agent decisions in 24h`)}</div>
    <div class="dh-filters" style="margin-top:1.5rem"><div class="dh-seg" id="mtype">${[['all', 'All 22'], ['stock', 'Stock tokens'], ['crypto', 'Crypto']].map(([k, t]) => `<button data-k="${k}" class="${mkState.type === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <input class="dh-input" id="mq" placeholder="Search a ticker or a name" style="max-width:18rem" value="${esc(mkState.q)}"></div>
    <div class="dh-card"><div class="dh-scroll"><table class="dh-table dh-mtable"><thead><tr><th data-s="name">Market</th><th class="num" data-s="price">Price</th><th class="num" data-s="change24h">24 hours</th><th class="num" data-s="change7d">7 days</th><th style="width:11rem">7-day range</th><th style="width:9rem">Last 7 days</th><th class="num">Agents</th></tr></thead><tbody id="mrows"></tbody></table></div></div>`)
  liveClock($('#clock'), st.lastHour, () => route())
  const draw = () => {
    const q = mkState.q.trim().toLowerCase(), list = rows.filter((m) => (mkState.type === 'all' || m.type === mkState.type) && (!q || m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)))
      .sort((a, b) => mkState.sort === 'name' ? mkState.dir * a.name.localeCompare(b.name) : mkState.dir * ((a[mkState.sort] ?? -1e9) - (b[mkState.sort] ?? -1e9)))
    $$('.dh-mtable th[data-s]').forEach((th) => { th.classList.toggle('on', th.dataset.s === mkState.sort); th.dataset.dir = mkState.dir > 0 ? '↑' : '↓' })
    $('#mrows').innerHTML = list.length ? list.map((m, i) => `<tr data-go="/markets/${m.symbol}" style="--i:${i}"><td>${mkt(m)}</td><td class="num">${usd(m.price)}</td><td class="num ${cls(m.change24h)}">${pct(m.change24h, 2)}</td><td class="num ${cls(m.change7d)}">${pct(m.change7d, 2)}</td>
      <td>${m.price != null ? range(m) : ''}</td><td>${spark(m.week.filter((x) => x != null), (m.change7d || 0) >= 0)}</td>
      <td class="num">${m.agents ? `<span class="dh-watch"><span class="dh-live"></span>${m.agents} running</span>` : `<a class="dh-btn is-quiet is-small" href="${briefFor(m.symbol)}" data-link>Add an agent</a>`}</td></tr>`).join('')
      : '<tr><td colspan="7"><div class="dh-empty">No market matches that.</div></td></tr>'
  }
  draw()
  $$('#mtype button').forEach((b) => (b.onclick = () => { mkState.type = b.dataset.k; $$('#mtype button').forEach((x) => x.classList.toggle('on', x === b)); draw() }))
  $('#mq').oninput = (e) => { mkState.q = e.target.value; draw() }
  $$('.dh-mtable th[data-s]').forEach((th) => (th.onclick = () => { const k = th.dataset.s; mkState.dir = mkState.sort === k ? -mkState.dir : k === 'name' ? 1 : -1; mkState.sort = k; draw() }))
}
async function marketOne(sym) {
  const m = await api('/markets/' + sym), cs = m.closes.filter((c) => c[1] != null), p = cs[cs.length - 1]?.[1], d = cs[cs.length - 25]?.[1], f = cs[0]?.[1]
  const ideas = [`Buy $50 of ${sym} every Monday at 14:00 UTC, with a budget of $1,000.`, `Buy ${sym} when it drops 5% in a day. Sell when it is up 8% or down 6%. Budget $2,000.`, `Buy ${sym} when it makes a new 3-day high, sell when it falls 2% below its 48 hour average. Stop loss 7%.`]
  page(`${head(`${esc(m.name)} <span class="dh-mute" style="font-weight:400">${sym}</span>`, `${m.type === 'stock' ? 'Stock token' : 'Token'} on Robinhood Chain, priced from its USDG pool.`, '', `<a href="/markets" data-link>Markets</a><span>/</span><span>${sym}</span>`)}
    <div class="dh-stats" style="margin-bottom:1.25rem">${stat('Price', usd(p))}${stat('24 hours', pct(d ? (p / d - 1) * 100 : null, 2), '', cls(p - d))}${stat('30 days', pct(f ? (p / f - 1) * 100 : null, 2), '', cls(p - f))}${stat('Hours of history', cs.length)}</div>
    <div class="dh-grid dh-21"><div class="dh-card"><h2>Last 30 days, hourly</h2>${chart(cs.map((c) => [c[0], c[1], c[1]]), cs[0]?.[1] || 0).replace(/<div class="dh-legend"><span><i><\/i>Agent[\s\S]*?<\/div>/, '<div></div>')}
      <p class="dh-small dh-mute" style="margin:1rem 0 0">Token contract <a href="${CHAIN.explorer}/token/${m.address}" target="_blank" rel="noopener" class="dh-mono">${m.address.slice(0, 10)}…${m.address.slice(-6)}</a></p></div>
    <div class="dh-card is-wash"><h3>Put an agent on ${sym}</h3><div class="dh-examples">${ideas.map((e) => `<button class="dh-example" type="button">${esc(e)}</button>`).join('')}</div></div></div>`)
  $$('.dh-example').forEach((b) => (b.onclick = () => go('/app?brief=' + encodeURIComponent(b.textContent))))
}

// ---- my desk ----
let deskTab = 'agents'
async function desk() {
  if (!me.address) { page(`${head('My desk', 'Your agents, the trades waiting for your signature, your listings and what they earned.')}<div class="dh-card"><div class="dh-empty">Connect a wallet to see your desk. Signing in costs no gas and moves nothing.<br><button class="dh-btn" id="deskConnect">Connect wallet</button></div></div>`)
    $('#deskConnect').onclick = async () => { if (await connect(toast)) desk() }; return }
  const d = await api('/me'), earned = d.sales.reduce((s, x) => s + x.paid, 0), value = d.agents.filter((a) => a.status !== 'stopped').reduce((s, a) => s + a.value, 0)
  const tabs = [['agents', 'Agents', 0], ['asks', 'Requests', d.approvals.length], ['listings', 'Listings', 0], ['history', 'History', 0]]
  const body = { agents: () => d.agents.length ? `<div class="dh-card"><div class="dh-scroll"><table class="dh-table"><thead><tr><th>Agent</th><th>Kind</th><th>Markets</th><th>Mode</th><th class="num">Value</th><th class="num">Return</th><th class="num">Holding</th><th class="num">Trades</th></tr></thead><tbody>${d.agents.map((a) => `<tr data-go="/agents/${a.id}"><td><b>${esc(a.name)}</b></td><td>${esc(a.kind)}</td><td>${toks(a.markets)}</td><td><span class="dh-status ${a.status}">${a.status === 'live' ? a.mode : a.status}</span></td><td class="num">${usd(a.value)}</td><td class="num ${cls(a.ret)}">${pct(a.ret, 2)}</td><td class="num ${cls(a.holdRet)}">${pct(a.holdRet, 2)}</td><td class="num">${a.trades}</td></tr>`).join('')}</tbody></table></div></div>`
      : '<div class="dh-card"><div class="dh-empty">No agent yet. Write one in a sentence, or install one from the marketplace.<br><a class="dh-btn" href="/app" data-link>Build an agent</a></div></div>',
    asks: () => d.approvals.length ? `<div class="dh-stack">${d.approvals.map(askHtml).join('')}</div>` : '<div class="dh-card"><div class="dh-empty">No trade is waiting for you. Agents in wallet mode send their requests here, and each one expires after 6 hours.</div></div>',
    listings: () => (d.listings.length ? `<div class="dh-card"><div class="dh-scroll"><table class="dh-table"><thead><tr><th>Listing</th><th>Status</th><th class="num">Price</th><th class="num">Installs</th><th class="num">Earned</th><th class="num">30 days</th></tr></thead><tbody>${d.listings.map((l) => `<tr data-go="/market/${l.id}"><td><b>${esc(l.name)}</b> <span class="dh-small dh-mute">v${l.version}</span></td><td><span class="dh-status ${l.status === 'live' ? 'live' : ''}">${l.status}</span></td><td class="num">${l.price ? usd(l.price) : 'Free'}</td><td class="num">${l.installs}</td><td class="num">${usd(l.earned)}</td><td class="num ${cls(l.ret)}">${pct(l.ret)}</td></tr>`).join('')}</tbody></table></div></div>` : '<div class="dh-card"><div class="dh-empty">Nothing published yet. Open one of your agents and use “Publish it”.</div></div>')
      + (d.sales.length ? `<div class="dh-card" style="margin-top:1.25rem"><h2>Sales</h2><div class="dh-scroll"><table class="dh-table"><thead><tr><th>Date</th><th>Listing</th><th>Buyer</th><th class="num">Paid</th><th>Payment</th></tr></thead><tbody>${d.sales.map((x) => `<tr><td>${day(x.created)}</td><td>${esc(x.name)} <span class="dh-small dh-mute">v${x.version}</span></td><td class="dh-mono dh-small">${esc(x.addr)}</td><td class="num">${x.paid ? usd(x.paid) : 'Free'}</td><td>${x.tx ? `<a href="${explorer(x.tx)}" target="_blank" rel="noopener">Transaction</a>` : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''),
    history: () => `<div class="dh-card"><h2>Everything your agents did</h2>${d.history.length ? logHtml(d.history, true) : '<div class="dh-empty">No trade yet. Waiting is logged on each agent’s own page.</div>'}</div>` }
  page(`${head('My desk', `Signed in as <span class="dh-mono">${d.address.slice(0, 6)}…${d.address.slice(-4)}</span>.`, '<a class="dh-btn" href="/app" data-link>Build an agent</a><button class="dh-btn is-quiet" id="out">Sign out</button>')}
    <div class="dh-stats" style="margin-bottom:1.5rem">${stat('Agents running', d.agents.filter((a) => a.status === 'live').length)}${stat('Value under agents', usd(value))}${stat('Waiting for you', d.approvals.length)}${stat('Listings', d.listings.filter((l) => l.status === 'live').length)}${stat('Earned', usd(earned), 'USDG, paid to your wallet')}</div>
    <div class="dh-tabs">${tabs.map(([k, t, n]) => `<button data-t="${k}" class="${deskTab === k ? 'on' : ''}">${t}${n ? `<sup>${n}</sup>` : ''}</button>`).join('')}</div><div id="deskBody">${body[deskTab]()}</div>`)
  $$('.dh-tabs button').forEach((b) => (b.onclick = () => { deskTab = b.dataset.t; desk() }))
  $('#out').onclick = async () => { await signOut(); desk() }
  bindAsks(desk)
}

// ---- routing ----
async function route() {
  const p = location.pathname.replace(/\/$/, '') || '/'; let m
  $$('.header-link-item').forEach((a) => a.classList.toggle('w--current', a.getAttribute('href') === '/' + p.split('/')[1]))
  try {
    if (p === '/app') await builder()
    else if (p === '/market') await market()
    else if ((m = /^\/market\/([a-f0-9]{10})$/.exec(p))) await listing(m[1])
    else if ((m = /^\/agents\/([a-f0-9]{10})$/.exec(p))) await agent(m[1])
    else if (p === '/board') await board()
    else if (p === '/markets') await markets()
    else if ((m = /^\/markets\/([A-Z]{2,6})$/.exec(p))) await marketOne(m[1])
    else if (p === '/desk') await desk()
    else page('<div class="dh-card"><div class="dh-empty">That page does not exist.<br><a class="dh-btn" href="/app" data-link>Open the builder</a></div></div>')
  } catch (e) { page(`<div class="dh-card"><div class="dh-empty">${esc(e.message)}<br><a class="dh-btn" href="/market" data-link>Back to the marketplace</a></div></div>`) }
  document.title = `${$('#app h1')?.textContent || 'Deskhand'} · Deskhand`
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]'); if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); return go(a.getAttribute('href')) }
  const row = e.target.closest('tr[data-go]'); if (row && !e.target.closest('a,button')) go(row.dataset.go)
})
window.addEventListener('popstate', route)
// the header button: connect, then it shows the wallet and opens the desk
const walletBtns = () => $$('[data-dh="wallet"]')
const paint = () => walletBtns().forEach((b) => { const t = $('.button_text', b); if (t) t.textContent = me.address ? me.address.slice(0, 6) + '…' + me.address.slice(-4) : 'Connect wallet' })
walletBtns().forEach((b) => b.addEventListener('click', async (e) => { e.preventDefault(); if (!me.address && !(await connect(toast))) return; go('/desk') }))
document.addEventListener('dh-me', paint)
if (eth()) eth().on?.('accountsChanged', async () => { if (me.address) { await signOut(); route() } })
await loadMe(); paint(); route()
