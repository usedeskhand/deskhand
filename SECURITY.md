# Security

## What is at stake

The server never holds a private key or user funds, so the surface is: the integrity of agents' books and listings, sessions, and the correctness of what the browser asks users to sign.

## Defences in the code

- Sign-in is a signed nonce (10 minutes, single use); sessions are random 192-bit tokens in an HttpOnly, SameSite=Lax cookie.
- Every write checks ownership on the server (agents, approvals, listings).
- Settlement reads the receipt on chain: the transaction must be confirmed, successful, sent by the owner, and move the right tokens; a hash can be booked once.
- Paid installs verify the USDG transfer to the creator on chain; a payment hash can be used once.
- Before any signature, `wallet.js` refuses a route that differs from the requested trade, and approves only the exact amount.
- Agents can only reference the 22 known markets; configs are validated and clamped server side.
- Prices that disagree with Chainlink by more than 2% (BTC, ETH) or that are isolated outliers are dropped.

## Reporting

Please report vulnerabilities privately through GitHub's *Report a vulnerability* (Security tab of this repository) rather than in a public issue. Include steps to reproduce. We will answer and credit you if you wish.
