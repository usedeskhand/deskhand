// Deskhand's state: one SQLite file (node:sqlite). Prices are hourly closes in USD.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export const DATA = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '../data')
fs.mkdirSync(DATA, { recursive: true })
export const db = new DatabaseSync(path.join(DATA, 'deskhand.db'))
db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS users (addr TEXT PRIMARY KEY, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nonces (addr TEXT PRIMARY KEY, nonce TEXT NOT NULL, message TEXT NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, addr TEXT NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS closes (symbol TEXT NOT NULL, hour INTEGER NOT NULL, close REAL NOT NULL, source TEXT NOT NULL, PRIMARY KEY (symbol, hour));
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, addr TEXT NOT NULL, name TEXT NOT NULL, brief TEXT NOT NULL DEFAULT '', config TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'paper',
  status TEXT NOT NULL, start_hour INTEGER NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL, house INTEGER NOT NULL DEFAULT 0, listing TEXT, version INTEGER);
CREATE TABLE IF NOT EXISTS decisions (agent TEXT NOT NULL, hour INTEGER NOT NULL, symbol TEXT NOT NULL, action TEXT NOT NULL, price REAL NOT NULL,
  qty REAL NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0, reason TEXT NOT NULL, tx TEXT, PRIMARY KEY (agent, hour, symbol));
CREATE TABLE IF NOT EXISTS equity (agent TEXT NOT NULL, hour INTEGER NOT NULL, value REAL NOT NULL, hold REAL NOT NULL, PRIMARY KEY (agent, hour));
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, agent TEXT NOT NULL, addr TEXT NOT NULL, hour INTEGER NOT NULL, symbol TEXT NOT NULL, action TEXT NOT NULL,
  usd REAL NOT NULL, qty REAL NOT NULL, price REAL NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, tx TEXT, created TEXT NOT NULL, settled TEXT);
CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, addr TEXT NOT NULL, name TEXT NOT NULL, pitch TEXT NOT NULL, version INTEGER NOT NULL, price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live', house INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS versions (listing TEXT NOT NULL, version INTEGER NOT NULL, brief TEXT NOT NULL, config TEXT NOT NULL, note TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (listing, version));
CREATE TABLE IF NOT EXISTS installs (id INTEGER PRIMARY KEY AUTOINCREMENT, listing TEXT NOT NULL, version INTEGER NOT NULL, addr TEXT NOT NULL, agent TEXT NOT NULL, paid REAL NOT NULL DEFAULT 0, tx TEXT UNIQUE, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS decisions_hour ON decisions (hour);
CREATE INDEX IF NOT EXISTS approvals_addr ON approvals (addr, status);`)

export const now = () => new Date().toISOString()
export const one = (sql, ...a) => db.prepare(sql).get(...a)
export const all = (sql, ...a) => db.prepare(sql).all(...a)
export const run = (sql, ...a) => db.prepare(sql).run(...a)
export const kv = { get: (k, d) => { const r = one('SELECT v FROM kv WHERE k = ?', k); return r ? JSON.parse(r.v) : d }, set: (k, v) => run('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v)) }
export const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } }

export const user = (addr) => {
  addr = addr.toLowerCase()
  run('INSERT OR IGNORE INTO users (addr, created) VALUES (?, ?)', addr, now())
  return one('SELECT * FROM users WHERE addr = ?', addr)
}
