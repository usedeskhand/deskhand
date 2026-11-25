# HTTP API

Base: `https://deskhand.markets/api`. JSON in, JSON out. Errors are `{ "error": "…" }` with a 4xx status and a sentence meant for a person.

## Public

| Method | Path | Returns |
|---|---|---|
| GET | `/stats` | live counts, last on-chain read, token info once launched |
| GET | `/config` | chain id, USDG address, example briefs, market token addresses |
| GET | `/markets` | every market: price, 24 h and 7 day change, 7-day range, sparkline, agents watching |
| GET | `/markets/:SYMBOL` | 30 days of hourly closes |
| GET | `/board` | running agents ranked by return |
| GET | `/activity?limit=40` | the latest decisions, trades first |
| GET | `/agents/:id` | one agent: value, holdings, rules, decision log, receipts |
| GET | `/listings` | the marketplace |
| GET | `/listings/:id` | one listing with its rules, permissions, versions and simulation |
| POST | `/draft` `{ brief, edits? }` | rules read from a brief + its 30-day replay |
| POST | `/simulate` `{ config }` | the 30-day replay of a config |
| GET | `/route?symbol=&side=buy&amount=` | a live LI.FI route for one trade |

## Session

Sign in by signing a message (no gas, nothing moves):

1. `POST /auth/nonce { address }` → `{ message }`
2. sign `message` with `personal_sign`
3. `POST /auth/verify { address, signature }` → sets an HttpOnly `dh` cookie (30 days)

`GET /me` returns your agents, pending approvals, listings, sales and history. `POST /auth/logout` ends the session.

## Signed in

| Method | Path | Does |
|---|---|---|
| POST | `/agents` `{ config, brief, mode: paper\|wallet }` | start an agent (up to 8 running) |
| POST | `/agents/:id/pause\|resume\|stop` | stopping is final |
| POST | `/approvals/:id/skip` | decline a trade request |
| POST | `/approvals/:id/settle` `{ tx }` | report the hash of the trade you signed; the server reads the receipt and books the real fill |
| POST | `/listings` `{ agent, pitch, price }` | publish one of your agents |
| POST | `/listings/:id/versions` `{ agent, note }` | publish new rules as a new version |
| POST | `/listings/:id/edit` `{ pitch?, price?, status? }` | edit or retire a listing |
| POST | `/listings/:id/install` `{ budget, mode, tx? }` | install your copy; a paid listing needs the hash of the USDG transfer to the creator (402 without it) |

Rate limits: briefs, simulations and routes are limited per address per minute.
