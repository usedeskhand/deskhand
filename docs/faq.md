# FAQ

**Is there a language model reading my brief?**
No. The reader is deterministic. That is a choice: the same words always give the same rules, and nothing can talk it into a different strategy. AI assistants connect from the outside, through the [MCP server](mcp.md).

**Does Deskhand hold funds or keys?**
No. Paper agents use simulated money. Wallet agents ask; you sign in your own wallet. There is no deposit and no vault.

**How often does an agent act?**
Once an hour, two minutes after the hour, right after prices are read on chain.

**Where do prices come from?**
From each market's USDG pool on Robinhood Chain; history from the same pools' hourly candles. See [markets](markets.md).

**Is a good replay a promise?**
No. It is one month that already happened, with costs on every trade. Use it to check that the agent does what you meant.

**What does it cost?**
Free during the beta. Wallet-mode trades pay the network, pool and routing fees shown before you sign. Creators keep the full price of their listings.

**Can I run it myself?**
Yes: `npm install && npm start`. See the [README](../README.md).
