// The agents Deskhand runs itself from the first hour, each published for free, so the marketplace opens with real agents
// and a real record. Every one is written as a brief and goes through the same reader as anyone else's.
import crypto from 'node:crypto'
import { one } from './db.mjs'
import { read } from './brief.mjs'
import { create, HOUSE } from './agents.mjs'
import { publish } from './market.mjs'

export const houseId = (name) => crypto.createHash('sha1').update('deskhand:' + name).digest('hex').slice(0, 10)
export const SEED = [
  ['Monday Chips', 'Buy $60 of NVDA and TSM every Monday at 14:00 UTC, with a budget of $1,500.', 'A plain weekly buy of the two chip names, at the US market open. For people who want exposure without watching a chart.'],
  ['Index Balance', 'Keep 50% SPY, 30% QQQ and 20% gold. Rebalance every week or when a weight drifts 5 points. Budget $5,000.', 'Three funds held at fixed weights. It sells what ran and buys what lagged, once a week or when the mix drifts.'],
  ['Tesla Dip Buyer', 'Buy TSLA when it drops 5% in a day. Sell when it is up 8% or down 6%. Budget $2,000.', 'Waits for a sharp one-day drop in Tesla, then exits on a fixed gain or a fixed loss. It does nothing most days.'],
  ['Chip Breakout', 'Buy chip stocks when they make a new 3-day high, sell when they fall 2% below their 48 hour average. Stop loss 7%. Budget $3,000.', 'Buys a chip name the hour it clears its three-day high and leaves when the move fades under its two-day average.'],
  ['Quiet Bitcoin', 'Buy $25 of bitcoin every day, only if it is below its 7 day average. Budget $750.', 'A daily bitcoin buy that skips the days when the price is above its weekly average. It only adds on weakness.'],
  ['Meme Rebound', 'Buy GME and AMC when RSI is below 30, sell when RSI is above 60. Hold at most 3 days. Budget $1,000.', 'Buys GameStop or AMC when they are oversold on the daily RSI and sells the bounce. Never holds longer than three days.'],
]
export function seedHouse() {
  if (one('SELECT COUNT(*) n FROM agents WHERE house = 1').n) return 0
  for (const [name, brief, pitch] of SEED) {
    const r = read(brief); if (!r.config) throw new Error('house brief unreadable: ' + brief)
    const agent = create(HOUSE, { config: { ...r.config, name }, brief, mode: 'paper' }, { house: true })
    publish(HOUSE, { agent, name, pitch, price: 0, id: houseId(name) }, true)
  }
  return SEED.length
}
