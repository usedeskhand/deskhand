<p align="center"><img src="public/brand/mark.svg" width="56" alt=""></p>
<h1 align="center">Deskhand</h1>
<p align="center">Trading agents you write in plain English, for stock tokens on Robinhood Chain.</p>
<p align="center"><a href="https://deskhand.markets">deskhand.markets</a> · <a href="https://x.com/usedeskhand">@usedeskhand</a></p>

---

You write a rule the way you would say it to a person:

> Buy TSLA when it drops 5% in a day. Sell when it's up 8% or down 6%. Budget $2,000.

Deskhand reads it into rules you can check line by line, replays those rules on the last 30 days of hourly on-chain prices, and then runs them every hour inside the budget and the tokens you allowed. You can publish an agent on the marketplace, free or priced in USDG, and other people install their own copy with their own budget.

This repository is the whole product: the server, the agent engine, the plain-English reader, the marketplace and the app.

## What is in here

| Path | What it does |
|---|---|
| `lib/brief.mjs` | Reads a plain-English brief into an agent config. A fixed parser, not a language model: the same sentence always gives the same rules, and anything it does not understand is handed back instead of guessed. Understands scheduled buys, buy/sell rules (moves over a period, price levels, averages, recent highs and lows, RSI) and baskets with target weights. |
| `lib/engine.mjs` | The decision engine. `plan()` reads one hour and returns what the agent wants to do and why; `apply()` books a trade. The 30-day replay, paper agents and wallet agents all go through `plan()`, so they decide the same way. 0.4% is charged on every simulated trade. |
| `lib/prices.mjs` | Hourly closes for 22 markets. History from the pools' hourly candles; every new hour is read on chain from each market's USDG pool (Uniswap v3 `slot0`, v4 `extsload`) two minutes after the hour. BTC and ETH are checked against their Chainlink feed; an hour more than 2% off the feed is skipped, and isolated bad prints are removed. |
| `lib/agents.mjs` | Agents: creation, the hourly tick, the public views. In **paper mode** the agent trades simulated money on live prices. In **wallet mode** it never moves anything: each trade becomes a request that expires after 6 hours, and only a confirmed on-chain transaction signed by the owner changes its books. |
| `lib/chain.mjs` | Reads receipts on Robinhood Chain: the real fill of an approved trade (from the token transfer logs, not from the estimate) and the USDG payment for a listing. Also fetches a live route (LI.FI) for a trade preview. |
| `lib/market.mjs` | The marketplace: versioned listings, installs with the buyer's own budget, paid listings settled wallet to wallet in USDG. Deskhand takes no cut and never holds the money. |
| `lib/mcp.mjs` | The MCP server (Streamable HTTP at `/mcp`): ten read-only tools so Claude, Cursor or any agent can draft agents from plain English, replay them on 30 days of prices, and read the markets, the marketplace, the leaderboard and the live decision log. An AI can research and draft; only the person can start an agent, from their own wallet. |
| `lib/auth.mjs` | Sign-in with a wallet signature (no gas, nothing moved) and an HttpOnly session cookie. |
| `lib/markets.mjs` | The 22 markets: 20 stock tokens, BTC and ETH, with their pool addresses on chain 4663. |
| `public/js/app.js` | The app: builder, simulation, marketplace, agent pages, leaderboard, markets, your desk. |
| `public/js/wallet.js` | Everything the browser signs. Before asking for a signature it checks that the route is exactly the trade the agent asked for (same tokens, same amount, same chain, sent to your own address) and approves only that amount. This page never sees a key. |
| `test/api.mjs` | Two throwaway wallets go through the whole product against a local server: sign-in, drafts, paper and wallet agents, approvals, forged transactions, publishing, installing, paid listings. |

## Run it

Node 22.5 or newer (it uses the built-in `node:sqlite`).

```bash
npm install
npm start
```

Open http://localhost:5570/app. On the first start the server loads 30 days of hourly prices for every market (a few minutes, the price source is rate limited), then starts the six house agents and runs every agent two minutes after each hour. Data lives in `data/` (or `DATA_DIR`).

```bash
npm test
```

## Use it from your AI (MCP)

```bash
claude mcp add --transport http deskhand https://deskhand.markets/mcp
```

Or add `{ "mcpServers": { "deskhand": { "url": "https://deskhand.markets/mcp" } } }` to your client's MCP config. Then ask: *"Draft a Deskhand agent that buys $50 of NVDA every Monday and show me how it did over the last month."* Locally the endpoint is `http://localhost:5570/mcp`.

Tools: `draft_agent`, `simulate_agent`, `list_markets`, `get_market_prices`, `list_marketplace`, `get_listing`, `leaderboard`, `get_agent`, `recent_decisions`, `stats`.

## What an agent can and cannot do

- It can only touch the tokens named in its rules, plus USDG, and only up to its budget.
- In wallet mode it cannot send a transaction: you sign every trade in your own wallet.
- There is no deposit, no vault and no custody. Nothing here ever holds a private key.
- It checks the market once an hour. It does not predict prices, and a 30-day replay is not a promise about the next 30 days.

## Not in this repository

The marketing pages of the public site are built on a licensed website template that cannot be redistributed, so they are not included. The app here runs on its own with a plain header.

## License

MIT
