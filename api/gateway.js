import crypto from 'node:crypto'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
const MAX_STATE_BYTES = 5 * 1024 * 1024

function reply(res, status, body) {
  res.statusCode = status
  for (const [key, value] of Object.entries(JSON_HEADERS)) res.setHeader(key, value)
  res.end(JSON.stringify(body))
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left || '') || !/^[a-f0-9]{64}$/i.test(right || '')) return false
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

function telegramUser(req) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw Object.assign(new Error('TELEGRAM_BOT_TOKEN is not configured'), { status: 503 })

  const raw = req.headers['x-telegram-init-data']
  if (!raw || typeof raw !== 'string') throw Object.assign(new Error('Open this app from Telegram'), { status: 401 })

  const params = new URLSearchParams(raw)
  const receivedHash = params.get('hash')
  params.delete('hash')
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
  const expectedHash = crypto.createHmac('sha256', secret).update(checkString).digest('hex')
  if (!safeEqualHex(receivedHash, expectedHash)) {
    throw Object.assign(new Error('Invalid Telegram authorization'), { status: 401 })
  }

  const authDate = Number(params.get('auth_date'))
  const maxAge = Math.max(60, Number(process.env.TELEGRAM_AUTH_MAX_AGE || 86400))
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > maxAge) {
    throw Object.assign(new Error('Telegram authorization expired — reopen the app'), { status: 401 })
  }

  let user
  try { user = JSON.parse(params.get('user') || '') } catch { /* handled below */ }
  if (!user?.id) throw Object.assign(new Error('Telegram user is missing'), { status: 401 })
  return {
    id: String(user.id),
    name: [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 80) || user.username || `Telegram ${user.id}`,
    username: user.username ? String(user.username).slice(0, 64) : null,
    languageCode: user.language_code ? String(user.language_code).slice(0, 12) : null,
  }
}

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw Object.assign(new Error('Supabase is not configured'), { status: 503 })
  return { url, key }
}

async function supabase(path, options = {}) {
  const { url, key } = supabaseConfig()
  const authHeaders = key.startsWith('sb_secret_')
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` }
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    console.error('Supabase request failed', response.status, data)
    throw Object.assign(new Error('Database request failed'), { status: 502 })
  }
  return data
}

async function upsertProfile(user) {
  const rows = await supabase('gym_profiles?on_conflict=telegram_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      telegram_id: user.id,
      name: user.name,
      username: user.username,
      language_code: user.languageCode,
      last_seen_at: new Date().toISOString(),
    }),
  })
  return rows?.[0] || null
}

async function getProfile(user) {
  const id = encodeURIComponent(user.id)
  const rows = await supabase(`gym_profiles?telegram_id=eq.${id}&select=telegram_id,name,username,language_code,state`)
  return rows?.[0] || null
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    languageCode: user.languageCode,
    telegram: true,
    admin: false,
  }
}

function requestBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'object') return req.body
  try { return JSON.parse(req.body) } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }) }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return reply(res, 204, {})
  const route = String(req.query?.route || '').replace(/^\/+|\/+$/g, '')
  const key = `${req.method} /${route}`

  try {
    if (key === 'GET /config') {
      return reply(res, 200, { telegram: true, invite_only: false })
    }
    if (key === 'GET /health') {
      supabaseConfig()
      return reply(res, 200, { ok: true, storage: 'supabase', auth: 'telegram' })
    }

    const user = telegramUser(req)

    if (key === 'GET /me') {
      await upsertProfile(user)
      return reply(res, 200, { user: publicUser(user) })
    }
    if (key === 'GET /data') {
      const profile = await getProfile(user) || await upsertProfile(user)
      return reply(res, 200, { state: profile?.state || null })
    }
    if (key === 'PUT /data') {
      const body = requestBody(req)
      if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
        return reply(res, 400, { error: 'state required' })
      }
      const state = structuredClone(body.state)
      delete state.active
      if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) {
        return reply(res, 413, { error: 'state is too large' })
      }
      await upsertProfile(user)
      await supabase(`gym_profiles?telegram_id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ state, updated_at: new Date().toISOString() }),
      })
      return reply(res, 200, { ok: true, ts: state._ts || null })
    }

    // Telegram authorization is supplied afresh by the host app, so there is no server
    // session to revoke. These routes remain compatible with the original client.
    if (key === 'POST /logout' || key === 'POST /logout/all') return reply(res, 200, { ok: true })
    if (key === 'POST /activity' || key.startsWith('POST /push/rest-timer')) return reply(res, 200, { ok: true })

    return reply(res, 404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    return reply(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' })
  }
}
