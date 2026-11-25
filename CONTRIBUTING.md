# Contributing

1. Fork, then `npm install` (Node 22.5+).
2. `npm start` and open http://localhost:5570/app. The first start loads 30 days of prices.
3. Make your change. Keep the engine pure (no I/O in `engine.mjs`) and keep every number the app shows traceable to the chain or to the engine.
4. `npm test` must pass.
5. Open a pull request that says what changed and why.

Good first areas: new phrasings in `lib/brief.mjs` (with a test sentence), new indicators in `lib/engine.mjs`, translations of the app's text.

Style: plain JavaScript modules, no build step, no framework. Messages shown to people are full sentences.
