// The markets Deskhand agents trade: Robinhood Chain stock tokens priced from their USDG pool, plus ETH and BTC.
// pool = v3 pool address or v4 pool id; t0 = the priced token is token0 of the pool (USDG is the other side).
export const CHAIN_ID = 4663
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'

const S = (symbol, name, address, pool, kind, t0, logo, decimals = 18) => ({ symbol, name, address, pool, kind, t0, decimals, logo, type: 'stock' })
export const MARKETS = [
  S('AAPL', 'Apple', '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', '0xaae0d815ee56e4092a5e5c2911e676fea50b2d6d', 'v3', false, 'apple'),
  S('AMC', 'AMC Entertainment', '0x05a3d1cd21d0c88145e82600e62e7e496e0f222b', '0x7499938c352d5b5b8f0c648722aca5ee964ef9b85c3a3041f1ec379726291d9d', 'v4', true, null),
  S('AMZN', 'Amazon', '0x12f190a9f9d7d37a250758b26824b97ce941bf54', '0x8ac92da74ab5f3b1d024dc1943ad7e15dc4179ef', 'v3', true, null),
  S('BABA', 'Alibaba', '0xad25ac6c84d497db898fa1e8387bf6af3532a1c4', '0xfe709115a71c7f9c007f2ac9cb932071ff3b3117865122134e2c1bd96719734c', 'v4', false, 'alibabadotcom'),
  S('CRCL', 'Circle', '0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5', '0x654e4143e82a5824445ade0824351c2a9acd95a8', 'v3', false, 'circle'),
  S('GLD', 'SPDR Gold Shares', '0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e', '0xba2f1ed4ceb2169d538d1e614d847e83c5a55913', 'v3', false, null),
  S('GME', 'GameStop', '0x1b0e319c6a659f002271b69db8a7df2f911c153e', '0xe2b46c905e12ab8e2f864e4821a4325884c1b126', 'v3', true, null),
  S('GOOGL', 'Alphabet', '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3', '0x34d0dc122cf9a8eb296fc5e0d3a233625d7d19b7', 'v3', true, 'google'),
  S('META', 'Meta Platforms', '0xc0d6457c16cc70d6790dd43521c899c87ce02f35', '0x5875d407a42965b0e768c8925cea290e06fa50603ef34fc99eb92a1050e6ae36', 'v4', false, 'meta'),
  S('MSTR', 'Strategy', '0xec262a75e413fafd0df80480274532c79d42da09', '0x319bac87e616a89e241c10aeb8afd4892a852cdd8b373cd9765ecddc40b87cfe', 'v4', false, null),
  S('MU', 'Micron Technology', '0xff080c8ce2e5feadaca0da81314ae59d232d4afd', '0xd057b1bc54917855bbee58ead58647f47cab35e5', 'v3', false, null),
  S('NVDA', 'NVIDIA', '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', '0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3', 'v3', false, 'nvidia'),
  S('PLTR', 'Palantir', '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a', '0xee430ee1003e1985e1828a01b9a20dad67ad4302994fe2abb4a173de4ac54623', 'v4', false, 'palantir'),
  S('QQQ', 'Invesco QQQ', '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68', '0xd60a5d14db690b7afad71f76b108071d7175597d', 'v3', false, null),
  S('RDDT', 'Reddit', '0x05b37fb53a299a1b874a619e1c4c404d52c36f4c', '0xa8744e76aed23b05f0126335e7bd38f7935d19fe', 'v3', true, 'reddit'),
  S('SPCX', 'SpaceX', '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', '0xc61284332117c3fb23a2a56cceffd07f7af60029', 'v3', true, 'spacex'),
  S('SPY', 'SPDR S&P 500', '0x117cc2133c37b721f49de2a7a74833232b3b4c0c', '0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd', 'v4', true, null),
  S('TSLA', 'Tesla', '0x322f0929c4625ed5bad873c95208d54e1c003b2d', '0x8517f8071ae5b831b738052f12125e8e3d6c158b78728aa44ce3b25e5104d32e', 'v4', true, 'tesla'),
  S('TSM', 'TSMC', '0x58ffe4a942d3885baa22d7520691f611ef09e7aa', '0x0ba5d53d2f6255f334b7c8ead4f56b6aef5af3402c5e4d11180afd38c6b85fb1', 'v4', true, null),
  S('USO', 'US Oil Fund', '0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344', '0x02175608f1b5e6b5ed221ccfdc7be197d111d915', 'v3', false, null),
  { symbol: 'ETH', name: 'Ethereum', address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', pool: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca', kind: 'v3', t0: true, decimals: 18, logo: 'ethereum', type: 'crypto', feed: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9' },
  { symbol: 'BTC', name: 'Bitcoin', address: '0xcec185eb182c47d1ba1efc84e6959e18cd620be4', pool: '0x9664d869540e9d0a76f12c6623946c6d5d201e09', kind: 'v3', t0: false, decimals: 8, logo: 'bitcoin', type: 'crypto', feed: '0x0009cD492adf8167f9eEBf1293556A673530a21a' },
]
export const BY_SYMBOL = Object.fromEntries(MARKETS.map((m) => [m.symbol, m]))
