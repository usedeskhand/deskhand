// Small behaviours shared by every page: clickable cards, the footer brief box, the token line once the token exists.
(() => {
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-href]'); if (card && !e.target.closest('a')) location.href = card.dataset.href
    const brief = e.target.closest('[data-brief]'); if (brief) location.href = '/app?brief=' + encodeURIComponent(brief.dataset.brief)
  })
  fetch('/api/config').then((r) => r.json()).then((c) => {
    const l = c.launch || {}; if (!l.ca) return
    const tok = document.querySelector('[data-dh="token"]'); if (tok) tok.textContent = `$${l.ticker || 'DESK'} ${l.ca}`
    const bar = document.createElement('div'); bar.className = 'dh-ca'
    bar.innerHTML = `<span>$${l.ticker || 'DESK'} on Robinhood Chain</span><code></code><button type="button">Copy</button>`; bar.querySelector('code').textContent = l.ca
    bar.querySelector('button').onclick = (ev) => navigator.clipboard.writeText(l.ca).then(() => { ev.target.textContent = 'Copied' })
    document.body.prepend(bar)
  }).catch(() => {})
})()
