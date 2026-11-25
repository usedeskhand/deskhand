// Sign-in with a wallet signature (no gas, no funds moved) → an HttpOnly session cookie.
import crypto from 'node:crypto'
import { verifyMessage, isAddress, getAddress } from 'viem'
import { one, run, now, user } from './db.mjs'

const DAY = 864e5, SESSION_DAYS = 30
const DOMAIN = process.env.DOMAIN || 'deskhand.markets'

export function nonce(addr) {
  if (!isAddress(addr)) throw Object.assign(new Error('That is not a wallet address.'), { code: 400 })
  const a = getAddress(addr), n = crypto.randomBytes(12).toString('hex')
  const message = `${DOMAIN} wants you to sign in with your wallet.\n\nSigning costs no gas and moves no funds.\n\nWallet: ${a}\nNonce: ${n}\nIssued: ${now()}`
  run('INSERT INTO nonces (addr, nonce, message, exp) VALUES (?, ?, ?, ?) ON CONFLICT(addr) DO UPDATE SET nonce = excluded.nonce, message = excluded.message, exp = excluded.exp',
    a.toLowerCase(), n, message, Date.now() + 10 * 60e3)
  return message
}

export async function verify(addr, signature) {
  if (!isAddress(addr) || typeof signature !== 'string') throw Object.assign(new Error('Missing signature.'), { code: 400 })
  const a = addr.toLowerCase(), row = one('SELECT * FROM nonces WHERE addr = ?', a)
  if (!row || row.exp < Date.now()) throw Object.assign(new Error('That sign-in expired. Try again.'), { code: 401 })
  const ok = await verifyMessage({ address: getAddress(addr), message: row.message, signature }).catch(() => false)
  if (!ok) throw Object.assign(new Error('The signature does not match this wallet.'), { code: 401 })
  run('DELETE FROM nonces WHERE addr = ?', a)
  user(a)
  const token = crypto.randomBytes(24).toString('base64url')
  run('INSERT INTO sessions (token, addr, exp) VALUES (?, ?, ?)', token, a, Date.now() + SESSION_DAYS * DAY)
  return token
}

export const cookie = (token, secure) => `dh=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSION_DAYS * 86400 : 0}${secure ? '; Secure' : ''}`
export const logout = (token) => run('DELETE FROM sessions WHERE token = ?', token)

export function who(req) {
  const m = /(?:^|;\s*)dh=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')
  if (!m) return null
  const s = one('SELECT * FROM sessions WHERE token = ? AND exp > ?', m[1], Date.now())
  return s ? { addr: s.addr, token: m[1] } : null
}
