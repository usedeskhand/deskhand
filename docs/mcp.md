# MCP server

Endpoint: `https://deskhand.markets/mcp` — Streamable HTTP, JSON responses, no key. Protocol `2025-06-18`.

```bash
claude mcp add --transport http deskhand https://deskhand.markets/mcp
```

```json
{ "mcpServers": { "deskhand": { "url": "https://deskhand.markets/mcp" } } }
```

Every tool is **read-only** (`readOnlyHint: true`). An AI can draft and replay agents and read everything public; starting an agent, signing and paying stay with the person, in the browser, from their wallet. `draft_agent` returns an `open_in_builder` link for that.

## Tools

### `draft_agent` — Draft an agent from plain English

Read a trading brief written in plain English (e.g. "Buy TSLA when it drops 5% in a day. Sell when it is up 8% or down 6%. Budget $2,000.") into Deskhand rules, and replay them on the last 30 days of hourly on-chain prices. Returns the rules, notes on anything assumed, the simulation, and a link that opens the draft in the Deskhand builder, where a person can start it. Understands scheduled buys, buy/sell rules (moves over a period, price levels, averages, recent highs/lows, RSI, take profit, stop loss) and baskets with target weights. Nothing is started.

| Argument | Type | |
|---|---|---|
| `brief` * | string | The strategy in plain English, up to 600 characters. Name the tokens, when to buy, when to sell and the budget. |

### `simulate_agent` — Replay an agent config

Replay an agent config (as returned by draft_agent, edited if you like: budget, amount, takeProfit, stopLoss, maxPerMarket, markets, weights) on the last 30 days of hourly on-chain prices, next to holding the same tokens. Costs of 0.4% are charged on every simulated trade.

| Argument | Type | |
|---|---|---|
| `config` * | object | An agent config with kind, markets, budget and the fields of its kind. |

### `list_markets` — Markets

The 22 markets Deskhand agents trade on Robinhood Chain (20 stock tokens, BTC, ETH): last hourly price from the on-chain USDG pool, 24 h and 7 day change, and how many agents watch each one.

No arguments.

### `get_market_prices` — Hourly prices of one market

Hourly closes of one market over the last 30 days (one point every 6 hours by default), read from its pool on Robinhood Chain.

| Argument | Type | |
|---|---|---|
| `symbol` * | string | Ticker, e.g. NVDA, TSLA, SPY, BTC. |
| `every_hours` | integer |  |

### `list_marketplace` — Marketplace

Agents published on the Deskhand marketplace: what each does, its markets, price in USDG (0 = free), installs and its 30-day simulated result next to holding.

No arguments.

### `get_listing` — One listing

Full detail of one marketplace listing: its rules, the permissions it asks for, its versions and its 30-day simulation.

| Argument | Type | |
|---|---|---|
| `id` * | string | Listing id from list_marketplace. |

### `leaderboard` — Running agents

Every agent running on Deskhand, ranked by return since it started, with its mode (paper or wallet), markets, trades and the return of simply holding its tokens.

No arguments.

### `get_agent` — One agent

One running agent: value, return, holdings, its rules and its latest decisions with the reason for each one.

| Argument | Type | |
|---|---|---|
| `id` * | string | Agent id from leaderboard. |

### `recent_decisions` — Live decision log

The latest decisions of the agents running on Deskhand, trades first, each with the reason the agent wrote.

| Argument | Type | |
|---|---|---|
| `limit` | integer |  |

### `stats` — Deskhand in numbers

Live counts: agents running, decisions logged, trades, listings, installs, markets, and the last hour of prices read on chain.

No arguments.

## Example session

> **You:** Draft a Deskhand agent that buys $50 of NVDA every Monday and tell me how it would have done last month.
>
> **Assistant** calls `draft_agent` with `{"brief": "Buy $50 of NVDA every Monday at 14:00 UTC, with a budget of $1,000."}`, reads back the rules and the 30-day replay against holding NVDA, and gives you the builder link to start it.

## Raw JSON-RPC

```bash
curl -s https://deskhand.markets/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_markets","arguments":{}}}'
```
