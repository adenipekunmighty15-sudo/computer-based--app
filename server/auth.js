import crypto from 'crypto'
import { promisify } from 'util'
import {
  getUserByToken,
  getUserByUsername,
  getUserById,
  createSession,
  deleteSession,
  deleteSessionsForUser,
  updateUserPassword,
} from './db.js'

const scrypt = promisify(crypto.scrypt)
const SALT_BYTES = 16
const KEY_LEN = 64

export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex')
  const buf = await scrypt(password, salt, KEY_LEN)
  return `${salt}:${buf.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false
  const [salt, key] = stored.split(':')
  if (!salt || !key) return false
  const buf = await scrypt(password, salt, KEY_LEN)
  const expected = Buffer.from(key, 'hex')
  // timingSafeEqual throws when the lengths differ, which is exactly what a
  // malformed or foreign stored hash looks like. Compare the same length so a
  // bad row answers "no" instead of a 500.
  if (expected.length !== buf.length) return false
  return crypto.timingSafeEqual(expected, buf)
}

// ── Middleware ──
export const SESSION_COOKIE = 'cbt_session'

export function getCookie(req, name) {
  const header = req.headers.cookie || ''
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

export function authRequired(roles = null) {
  return (req, res, next) => {
    const token = getCookie(req, SESSION_COOKIE) || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    const user = token ? getUserByToken(token) : null
    if (!user) return res.status(401).json({ error: 'Not authenticated' })
    if (roles && !roles.includes(user.role)) return res.status(403).json({ error: 'Access denied for your role' })
    req.user = user
    next()
  }
}

export async function login({ username, password, role }) {
  const user = getUserByUsername((username || '').trim())
  if (!user) return { ok: false, error: 'Invalid username or password' }
  const valid = await verifyPassword(password || '', user.password_hash)
  if (!valid) return { ok: false, error: 'Invalid username or password' }
  if (role && user.role !== role) return { ok: false, error: 'Invalid username or password for the selected portal' }
  const { password_hash, ...safe } = user
  const token = createSession(user.id)
  return { ok: true, token, user: safe }
}

export function logout(token) {
  if (token) deleteSession(token)
}

/* A password change is the one action that must prove it is really you, so the
   current password is checked first even though a valid session is already
   presented. Every other device is signed out — a changed password that leaves
   old sessions alive is not a change at all. */
export async function changePassword({ userId, currentPassword, newPassword, keepToken }) {
  const row = getUserById(userId)
  if (!row) return { ok: false, error: 'Account not found' }
  if (!(await verifyPassword(currentPassword || '', row.password_hash))) {
    return { ok: false, error: 'Your current password is not correct' }
  }
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: 'New password must be at least 6 characters' }
  }
  if (await verifyPassword(newPassword, row.password_hash)) {
    return { ok: false, error: 'New password must be different from the current one' }
  }
  updateUserPassword(userId, await hashPassword(newPassword))
  deleteSessionsForUser(userId, keepToken)
  return { ok: true }
}

// Simple in-memory sliding-window rate limiter, keyed by user+route.
// A school shares one public IP, so keying authenticated routes by IP meant one
// busy pupil could exhaust the whole campus's allowance. Authenticated requests
// are now keyed by user id; unauthenticated ones (login, register) stay IP-keyed.
export function rateLimit({ windowMs = 60000, max = 30, message = 'Too many requests, slow down.', key: makeKey } = {}) {
  const hits = new Map()
  return (req, res, next) => {
    const identity = req.user?.id != null ? `u:${req.user.id}` : `ip:${req.ip}`
    const key = makeKey ? makeKey(req) : `${identity}:${req.path}`
    const now = Date.now()
    const entry = hits.get(key) || { count: 0, start: now }
    if (now - entry.start > windowMs) {
      entry.count = 0
      entry.start = now
    }
    entry.count += 1
    hits.set(key, entry)
    if (entry.count > max) return res.status(429).json({ error: message })
    next()
  }
}