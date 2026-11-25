# The engine

`lib/engine.mjs` has no I/O. It takes a config, a state and price windows, and returns decisions.

## Indicators

Computed on a window of hourly closes, oldest first, the last one being the current hour.

| Name | Definition |
|---|---|
| `price` | last close |
| `avg(h)` | mean of the last *h* closes |
| `high(h)`, `low(h)` | max / min of the *h* closes before the current one |
| `change(h)` | percent change over *h* hours |
| `rsi(h)` | RSI over *h* hours (100 when there was no down move) |

Windows: 1, 6, 12, 24, 48, 72, 168 hours. An agent needs 168 hours of history before its first decision.

## A rule

`{ a, op, b, pct }`: `a` is an indicator, `b` an indicator or a number, `op` one of `above`, `below`, `crosses_above`, `crosses_below` (compared with the previous hour), and `pct` moves `b` by a percentage (−2 = 2% under).

## plan()

For each market of the agent:

- **Exits first** (rules and scheduled buys): stop loss, take profit, maximum holding time, measured from the average entry.
- **Rules:** if holding, sell when any sell rule is met; if not holding, buy when *all* buy rules are met, sized by `amount`, the cash left and `maxPerMarket`.
- **Scheduled buy:** buy `amount` at the scheduled hour (UTC) if the optional conditions are met and cash is left; a skipped run is not retried until the next one.
- **Basket:** on schedule, or as soon as a weight is `drift` points off target, sell what is over and buy what is under, sells first so buys only use cash that exists.

Every intent carries a sentence: what was checked, the number seen, and what was done. That sentence is what the decision log shows.

## apply()

Books a trade. A buy moves the average entry; a sell books cash and counts a win if it sold above entry plus costs. In wallet mode `apply()` is called with the **real fill read from the transaction receipt**, not with the estimate.

## replay()

Runs `plan` + `apply` hour by hour over a window (the last 720 hours in the app) and returns the value curve, the curve of holding the same tokens bought on the first hour (with the basket's weights for a basket), the trades, the costs and the largest drop.

## Validation

`clean()` checks every config that reaches the server: known markets (up to 6), budget between $20 and $1,000,000, weights that do not add up to more than 100%, rules that are complete, and at least one way to sell for a rules agent.
