# The brief language

A brief is one or a few sentences in plain English. `lib/brief.mjs` reads it with fixed rules (regular expressions over the lowercased text), not with a language model, so:

- the same sentence always gives the same agent;
- a word it does not know is ignored, never guessed;
- if something essential is missing (no market, no buying condition) it stops and says what to add;
- if you say when to buy but not when to sell, it adds a 10% take profit and an 8% stop loss **and tells you**.

Always read the rules it shows back before starting an agent.

## Three kinds of agent

| Kind | Recognised when | Example |
|---|---|---|
| **Basket** | two or more "NN% TICKER" pairs | Keep 50% SPY, 30% QQQ and 20% gold. Rebalance every week or when a weight drifts 5 points. |
| **Scheduled buy** | "every Monday / every day / every 6 hours…" with a buy verb, and no "when" condition (an "only if" condition is allowed) | Buy $50 of NVDA every Monday at 14:00 UTC. |
| **Rules** | everything else | Buy TSLA when it drops 5% in a day. Sell when it is up 8% or down 6%. |

## Markets

Tickers (`NVDA`, `$TSLA`), names (`Tesla`, `gold`, `the S&P`, `nasdaq`, `bitcoin`) and groups:

| Group | Markets |
|---|---|
| chip stocks, chips, semis | NVDA, MU, TSM |
| meme stocks, memes | GME, AMC |
| big tech | AAPL, AMZN, GOOGL, META, NVDA |
| the indexes, indices | SPY, QQQ |
| crypto | BTC, ETH |

## Conditions

| You write | Rule |
|---|---|
| drops 5% in a day · falls 4% over 6 hours · up 3% in a week | the change over that period is below / above the number |
| below $150 · above 200 dollars · crosses above $300 | the price against a level |
| 2% below its 48 hour average · 3% above the 7 day average | the price against an average, offset by a percentage |
| below its 2 day average · crosses above its weekly average | the price against an average |
| makes a new 3-day high · breaks out · new weekly low | the price crosses its recent high or low |
| RSI below 30 · RSI(24) above 70 · oversold · overbought | the RSI over a window (oversold = below 30, overbought = above 70) |

Periods snap to the windows the engine keeps: 1, 6, 12, 24, 48 and 72 hours, and 7 days.

## Exits

| You write | Meaning |
|---|---|
| take profit 10% · sell when it is up 8% | sell the position when it is up that much from its average entry |
| stop loss 5% · sell when it is down 6% · cut losses at 7% | sell when it is down that much from its average entry |
| hold at most 3 days · sell after 2 days | sell after that many hours |

In a sell sentence, a move with no period ("up 8%") means "from my entry". With a period ("falls 4% in a day") it is a market condition.

## Money

| You write | Meaning |
|---|---|
| budget $2,000 · with $5k · never spend more than $1,000 | total budget (default $1,000; for a scheduled buy, 30 days of buys) |
| $200 per trade · $50 each buy | size of each buy |
| at most 50% per trade · max 25% in one market | the most of the budget in one market |
| ask me before each trade | suggests wallet mode |

## The examples from the builder, read today (2026-11-25)

### “Buy $50 of NVDA every Monday at 14:00 UTC, with a budget of $1,000.”

- **Buys:** $50.00 of NVDA every Monday at 14:00 UTC
- **Budget:** $1,000.00 in total. The agent can never spend more than what is left of it.

30-day replay: agent **−3.16%**, holding the same tokens −33.51%, 4 trades, largest drop −4.5%.

### “Buy TSLA when it drops 5% in a day. Sell when it is up 8% or down 6%. Budget $2,000, at most 50% per trade.”

- **Watches:** TSLA
- **Buys when:** the 1-day change is below −5%
- **Size:** whatever is left of the budget, at most 50% of the budget in one market
- **Take profit:** sells a position that is up 8% from its average entry
- **Stop loss:** sells a position that is down 6% from its average entry
- **Budget:** $2,000.00 in total. The agent can never spend more than what is left of it.

30-day replay: agent **−0.07%**, holding the same tokens −7.53%, 5 trades, largest drop −6.4%.

### “Keep 50% SPY, 30% QQQ and 20% gold. Rebalance every week or when a weight drifts 5 points. Budget $5,000.”

- **Holds:** 50% SPY, 30% QQQ, 20% GLD
- **Rebalances:** every week, or as soon as a weight is 5 points off target
- **Budget:** $5,000.00 in total. The agent can never spend more than what is left of it.

30-day replay: agent **−10.88%**, holding the same tokens −10.92%, 8 trades, largest drop −13.0%.

### “Buy chip stocks when they make a new 3-day high, sell when they fall 2% below their 48 hour average. Stop loss 7%.”

- **Watches:** NVDA, MU, TSM
- **Buys when:** the price crosses above its 3-day high
- **Sells when:** the price is 2% below its 2-day average
- **Size:** whatever is left of the budget, at most 33% of the budget in one market
- **Stop loss:** sells a position that is down 7% from its average entry
- **Budget:** $1,000.00 in total. The agent can never spend more than what is left of it.

> No budget given, so it starts at $1,000. Change it below.

30-day replay: agent **−9.40%**, holding the same tokens −32.35%, 24 trades, largest drop −12.0%.

### “Buy $25 of bitcoin every day, only if it is below its 7 day average.”

- **Buys:** $25.00 of BTC every day at 14:00 UTC
- **Only if:** the price is below its 7-day average
- **Budget:** $750.00 in total. The agent can never spend more than what is left of it.

> No total budget given, so it is set to 30 days of buys: $750.

30-day replay: agent **−14.34%**, holding the same tokens −26.32%, 28 trades, largest drop −18.1%.

### “Buy GME when RSI is below 30, sell when RSI is above 60. Hold at most 3 days.”

- **Watches:** GME
- **Buys when:** the 1-day RSI is below 30
- **Sells when:** the 1-day RSI is above 60
- **Size:** whatever is left of the budget
- **Max holding time:** 72 hours
- **Budget:** $1,000.00 in total. The agent can never spend more than what is left of it.

> No budget given, so it starts at $1,000. Change it below.

30-day replay: agent **−0.23%**, holding the same tokens +10.31%, 9 trades, largest drop −4.4%.

Replays move every hour with the prices; run them again in the builder or through the MCP tool `draft_agent`.
