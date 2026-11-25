# Paper mode and wallet mode

## Paper mode

Simulated money on live prices. The agent books its own trades with a 0.4% cost. Nothing touches a wallet; the signature at sign-in only proves the agent is yours.

## Wallet mode

The agent cannot send anything. When its rules call for a trade:

1. **Request.** The server writes an approval: market, side, amount, the reason, valid six hours. The owner sees it in *My desk → Requests* and on the agent page.
2. **Route.** When the owner opens it, `wallet.js` asks LI.FI for a quote **for the owner's own address**.
3. **Check.** Before any signature, the quote must be exactly the requested trade: same tokens, same amount, chain 4663 on both sides, sent to the owner's address. Otherwise nothing is sent.
4. **Allowance.** If the router needs one, it is for that exact amount, never unlimited.
5. **Sign.** The owner signs the swap in their wallet.
6. **Settle.** The page reports the transaction hash. The server reads the receipt on chain and books the **real** amounts from the token transfers (a buy that spent more than requested is refused). The hash is kept as the receipt.

A request that is skipped or expires changes nothing. A sell of everything the agent holds sells the whole wallet balance of that token when only rounding dust would remain.

## Tested on a fork

The full path (request → route → approve → swap → settle, then a sell, then a paid listing) is run against a local fork of Robinhood Chain with real pools and real LI.FI routes before releases: 19 checks, last green on 2026-11-25.
