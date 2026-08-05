import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, fsyncSync, mkdirSync, openSync, closeSync, readFileSync, readSync, readdirSync, renameSync, statSync, statfsSync, unlinkSync, writeSync } from 'node:fs'
import { appendFile, rm } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DatabaseSync } from 'node:sqlite'

const ALLOWED_UPSTREAM_PATHS = new Set([
  'images/generations',
  'images/edits',
  'responses',
])
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'unknown'])
const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRYABLE_UPSTREAM_ERROR_CODES = new Set(['image_stream_timeout', 'upstream_timeout'])
const NON_RETRYABLE_UPSTREAM_MARKERS = [
  'content_policy_violation',
  'image_unsafe',
  'moderation_blocked',
  'safety_violations',
]
const ENCRYPTED_FILE_HEADER = Buffer.from('IJ01')
const ENCRYPTED_FILE_HEADER_BYTES = ENCRYPTED_FILE_HEADER.length + 12
const AUTH_TAG_BYTES = 16

class HttpError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

const readInteger = (value, fallback, min, max) => {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error('invalid numeric image job configuration')
  }
  return parsed
}

const parseEncryptionKey = (value, source = 'IMAGE_JOB_ENCRYPTION_KEY') => {
  if (!value) throw new Error(`${source} is required`)
  const key = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error(`${source} must contain exactly 32 bytes`)
  return key
}

const readEncryptionKey = (env) => {
  const keyFile = env.IMAGE_JOB_ENCRYPTION_KEY_FILE?.trim()
  if (!keyFile) return parseEncryptionKey(env.IMAGE_JOB_ENCRYPTION_KEY)

  let value
  try {
    value = readFileSync(keyFile, 'utf8')
  } catch {
    throw new Error('IMAGE_JOB_ENCRYPTION_KEY_FILE could not be read')
  }
  if (value.length > 4096) throw new Error('IMAGE_JOB_ENCRYPTION_KEY_FILE is too large')
  return parseEncryptionKey(value.trim(), 'IMAGE_JOB_ENCRYPTION_KEY_FILE')
}

const normalizeIpAddress = (value) => {
  if (!value) return null
  const withoutZone = value.trim().split('%')[0]
  const mapped = withoutZone.startsWith('::ffff:') ? withoutZone.slice(7) : withoutZone
  return isIP(mapped) ? mapped : null
}

const ipv4ToInteger = (value) => value.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0)

const parseTrustedProxyCidrs = (value) => {
  if (!value?.trim()) return []
  return value.split(',').map((raw) => {
    const entry = raw.trim()
    const parts = entry.split('/')
    const address = normalizeIpAddress(parts[0])
    const prefix = parts.length === 1 ? 32 : Number(parts[1])
    if (parts.length > 2 || !address || isIP(address) !== 4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error('IMAGE_JOB_TRUST_PROXY_CIDRS must contain valid IPv4 CIDRs')
    }
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return { mask, network: ipv4ToInteger(address) & mask }
  })
}

const parseResultImageHosts = (value) => {
  if (!value?.trim()) return new Set()
  return new Set(value.split(',').map((raw) => {
    const host = raw.trim().toLowerCase()
    const hostname = host.startsWith('*.') ? host.slice(2) : host
    if (
      !hostname
      || hostname.includes('*')
      || hostname.includes('/')
      || hostname.includes(':')
      || /\s/.test(hostname)
    ) {
      throw new Error('IMAGE_JOB_RESULT_IMAGE_HOSTS must contain comma-separated hostnames')
    }
    return host
  }))
}

export const isAllowedResultImageHost = (host, rules) => rules.has(host) || [...rules].some((rule) =>
  rule.startsWith('*.') && host.length > rule.length - 1 && host.endsWith(rule.slice(1)),
)

const isTrustedProxyAddress = (address, cidrs) => {
  const normalized = normalizeIpAddress(address)
  if (!normalized || isIP(normalized) !== 4) return false
  const value = ipv4ToInteger(normalized)
  return cidrs.some((cidr) => (value & cidr.mask) === cidr.network)
}

const normalizeUpstream = (value) => {
  if (!value) throw new Error('IMAGE_JOB_UPSTREAM_URL is required')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('IMAGE_JOB_UPSTREAM_URL must be a fixed HTTP(S) base URL')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

const normalizeRequestedPath = (value) => {
  const normalized = value?.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized || !ALLOWED_UPSTREAM_PATHS.has(normalized)) {
    throw new HttpError(400, 'unsupported_upstream_path')
  }
  return normalized
}

const getHeader = (req, name) => {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

const safeRequestId = (value) => {
  if (!value || value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value)) return null
  return value
}

const toIso = (value) => value ? new Date(value).toISOString() : null

const parseRetryAfterMs = (value) => {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, timestamp - Date.now())
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isSameDigest = (left, right) => {
  if (!left || !right || left.length !== right.length) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

const sendJson = (res, status, body) => {
  if (res.destroyed || res.writableEnded) return
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': data.length,
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(data)
}

const writeEncryptedStream = async ({ readable, target, key, maxBytes, checkDisk, reserveDisk, protectedFiles, expectedBytes = maxBytes }) => {
  const temp = `${target}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const hash = createHash('sha256')
  const reservation = reserveDisk(expectedBytes + ENCRYPTED_FILE_HEADER_BYTES + AUTH_TAG_BYTES)
  protectedFiles?.add(temp)
  let size = 0
  let nextDiskCheck = 16 * 1024 * 1024
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      if (size > maxBytes) {
        callback(new HttpError(413, 'body_too_large'))
        return
      }
      if (size >= nextDiskCheck) {
        nextDiskCheck = size + 16 * 1024 * 1024
        try {
          checkDisk()
        } catch (err) {
          callback(err)
          return
        }
      }
      hash.update(chunk)
      reservation.consume(chunk.length)
      callback(null, chunk)
    },
  })

  try {
    const fd = openSync(temp, 'wx', 0o600)
    try {
      writeSync(fd, Buffer.concat([ENCRYPTED_FILE_HEADER, iv]))
      reservation.consume(ENCRYPTED_FILE_HEADER_BYTES)
    } finally {
      closeSync(fd)
    }
    await pipeline(readable, limiter, cipher, createWriteStream(temp, { flags: 'a', mode: 0o600 }))
    await appendFile(temp, cipher.getAuthTag())
    reservation.consume(AUTH_TAG_BYTES)
    const syncFd = openSync(temp, 'r+')
    try {
      fsyncSync(syncFd)
    } finally {
      closeSync(syncFd)
    }
    renameSync(temp, target)
    const dirFd = openSync(path.dirname(target), 'r')
    try {
      fsyncSync(dirFd)
    } finally {
      closeSync(dirFd)
    }
    return { digest: hash.digest('hex'), size }
  } catch (err) {
    await rm(temp, { force: true })
    throw err
  } finally {
    protectedFiles?.delete(temp)
    reservation.release()
  }
}

const writeEncryptedBuffer = (opts, value) => writeEncryptedStream({
  ...opts,
  readable: Readable.from([value]),
  maxBytes: value.length,
  expectedBytes: value.length,
})

const createDecryptedStream = (file, key) => {
  const stats = statSync(file)
  if (stats.size < ENCRYPTED_FILE_HEADER_BYTES + AUTH_TAG_BYTES) {
    throw new Error('invalid encrypted file')
  }
  const fd = openSync(file, 'r')
  const header = Buffer.alloc(ENCRYPTED_FILE_HEADER_BYTES)
  const tag = Buffer.alloc(AUTH_TAG_BYTES)
  readSync(fd, header, 0, header.length, 0)
  readSync(fd, tag, 0, tag.length, stats.size - tag.length)
  closeSync(fd)
  if (!header.subarray(0, ENCRYPTED_FILE_HEADER.length).equals(ENCRYPTED_FILE_HEADER)) {
    throw new Error('invalid encrypted file')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(ENCRYPTED_FILE_HEADER.length))
  decipher.setAuthTag(tag)
  if (stats.size === ENCRYPTED_FILE_HEADER_BYTES + AUTH_TAG_BYTES) {
    return Readable.from([]).pipe(decipher)
  }
  return createReadStream(file, {
    start: ENCRYPTED_FILE_HEADER_BYTES,
    end: stats.size - AUTH_TAG_BYTES - 1,
  }).pipe(decipher)
}

const readEncryptedJson = async (file, key, maxBytes = 64 * 1024) => {
  const chunks = []
  let size = 0
  for await (const chunk of createDecryptedStream(file, key)) {
    size += chunk.length
    if (size > maxBytes) throw new Error('encrypted metadata is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const removeFile = (file) => {
  if (!file) return
  try {
    unlinkSync(file)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

const removeFileQuietly = (file) => {
  try {
    removeFile(file)
  } catch {}
}

const postStream = (target, headers, body, signal) => new Promise((resolve, reject) => {
  const client = target.protocol === 'https:' ? https : http
  let settled = false
  const req = client.request(target, {
    method: 'POST',
    headers,
    signal,
  }, (res) => {
    settled = true
    const status = res.statusCode || 502
    resolve({
      body: res,
      headers: {
        get(name) {
          const value = res.headers[name.toLowerCase()]
          if (Array.isArray(value)) return value.join(', ')
          return value ?? null
        },
      },
      ok: status >= 200 && status < 300,
      status,
    })
  })
  req.on('error', (err) => {
    if (!settled) reject(err)
  })
  body.on('error', (err) => req.destroy(err))
  body.pipe(req)
})

export const createImageJobProxy = (options = {}) => {
  const env = { ...process.env, ...options.env }
  const key = readEncryptionKey(env)
  const upstream = normalizeUpstream(env.IMAGE_JOB_UPSTREAM_URL)
  const dataDir = path.resolve(env.IMAGE_JOB_DATA_DIR || '/var/lib/image-jobs')
  const config = {
    cleanupIntervalMs: readInteger(env.IMAGE_JOB_CLEANUP_INTERVAL_MS, 300_000, 100, 86_400_000),
    diskMinFreeBytes: readInteger(env.IMAGE_JOB_DISK_MIN_FREE_BYTES, 1024 ** 3, 0, Number.MAX_SAFE_INTEGER),
    diskMinFreePercent: readInteger(env.IMAGE_JOB_DISK_MIN_FREE_PERCENT, 10, 0, 99),
    failureTtlMs: readInteger(env.IMAGE_JOB_FAILURE_TTL_MS, 72 * 60 * 60 * 1000, 1_000, 365 * 24 * 60 * 60 * 1000),
    host: env.IMAGE_JOB_HOST || '0.0.0.0',
    ingestTimeoutMs: readInteger(env.IMAGE_JOB_INGEST_TIMEOUT_MS, 600_000, 1_000, 1_200_000),
    maxActivePerSubject: readInteger(env.IMAGE_JOB_MAX_ACTIVE_PER_SUBJECT, 3, 1, 1000),
    maxBodyBytes: readInteger(env.IMAGE_JOB_MAX_BODY_BYTES, 600 * 1024 * 1024, 1, Number.MAX_SAFE_INTEGER),
    maxConcurrency: readInteger(env.IMAGE_JOB_MAX_CONCURRENCY, 4, 1, 128),
    maxQueue: readInteger(env.IMAGE_JOB_MAX_QUEUE, 100, 1, 100_000),
    maxAttempts: readInteger(env.IMAGE_JOB_MAX_ATTEMPTS, 2, 1, 3),
    maxResultBytes: readInteger(env.IMAGE_JOB_MAX_RESULT_BYTES, 600 * 1024 * 1024, 1, Number.MAX_SAFE_INTEGER),
    maxWaitersPerJob: readInteger(env.IMAGE_JOB_MAX_WAITERS_PER_JOB, 4, 1, 100),
    port: readInteger(env.IMAGE_JOB_PORT, 3001, 0, 65_535),
    resultImageHosts: parseResultImageHosts(env.IMAGE_JOB_RESULT_IMAGE_HOSTS),
    resultImageTimeoutMs: readInteger(env.IMAGE_JOB_RESULT_IMAGE_TIMEOUT_MS, 120_000, 1_000, 1_200_000),
    retryBaseDelayMs: readInteger(env.IMAGE_JOB_RETRY_BASE_DELAY_MS, 2_000, 0, 60_000),
    retryMaxDelayMs: readInteger(env.IMAGE_JOB_RETRY_MAX_DELAY_MS, 60_000, 0, 300_000),
    successTtlMs: readInteger(env.IMAGE_JOB_SUCCESS_TTL_MS, 24 * 60 * 60 * 1000, 1_000, 365 * 24 * 60 * 60 * 1000),
    trustedProxyCidrs: parseTrustedProxyCidrs(env.IMAGE_JOB_TRUST_PROXY_CIDRS),
    upstreamTimeoutMs: readInteger(env.IMAGE_JOB_UPSTREAM_TIMEOUT_MS, 1_200_000, 100, 1_200_000),
  }
  if (config.retryBaseDelayMs > config.retryMaxDelayMs) {
    throw new Error('IMAGE_JOB_RETRY_BASE_DELAY_MS must not exceed IMAGE_JOB_RETRY_MAX_DELAY_MS')
  }
  const logger = options.logger || ((entry) => process.stdout.write(`${JSON.stringify(entry)}\n`))

  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const dbPath = path.join(dataDir, 'jobs.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      token_digest TEXT NOT NULL,
      auth_digest TEXT NOT NULL,
      ip_digest TEXT NOT NULL,
      upstream_path TEXT NOT NULL,
      request_file TEXT,
      headers_file TEXT,
      request_size INTEGER NOT NULL,
      request_digest TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      upstream_status INTEGER,
      result_file TEXT,
      result_meta_file TEXT,
      result_size INTEGER,
      result_digest TEXT,
      error_code TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS jobs_auth_status_idx ON jobs(auth_digest, status);
    CREATE INDEX IF NOT EXISTS jobs_ip_status_idx ON jobs(ip_digest, status);
  `)
  if (!db.prepare('PRAGMA table_info(jobs)').all().some((column) => column.name === 'attempt_count')) {
    db.exec('ALTER TABLE jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0')
  }

  const hmac = (purpose, value) => createHmac('sha256', key).update(purpose).update('\0').update(value).digest('hex')
  const filePath = (name) => path.join(dataDir, name)
  const jobFileStem = (id) => createHash('sha256').update(id).digest('hex')
  const rowForId = db.prepare('SELECT * FROM jobs WHERE id = ?')
  const statusForId = db.prepare('SELECT status FROM jobs WHERE id = ?')
  const queuedCount = db.prepare("SELECT count(*) AS count FROM jobs WHERE status = 'queued'")
  const activeByAuth = db.prepare("SELECT count(*) AS count FROM jobs WHERE auth_digest = ? AND status IN ('queued', 'dispatch_reserved', 'running')")
  const activeByIp = db.prepare("SELECT count(*) AS count FROM jobs WHERE ip_digest = ? AND status IN ('queued', 'dispatch_reserved', 'running')")
  const queue = []
  const queuedIds = new Set()
  const receiving = new Map()
  const dispatchControllers = new Map()
  const dispatchPromises = new Set()
  const protectedFiles = new Set()
  let running = 0
  let pumping = false
  let closing = false
  let forceClosing = false
  let cleanupTimer
  let reservedDiskBytes = 0

  const transact = (fn) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  const checkDisk = (additionalBytes = 0) => {
    const stats = statfsSync(dataDir)
    const free = Number(stats.bavail) * Number(stats.bsize)
    const total = Number(stats.blocks) * Number(stats.bsize)
    const minimum = Math.max(config.diskMinFreeBytes, Math.ceil(total * config.diskMinFreePercent / 100))
    if (free - reservedDiskBytes - additionalBytes < minimum) throw new HttpError(507, 'disk_watermark_reached')
  }

  const reserveDisk = (bytes) => {
    checkDisk(bytes)
    reservedDiskBytes += bytes
    let remaining = bytes
    return {
      consume(consumed) {
        const amount = Math.min(remaining, consumed)
        remaining -= amount
        reservedDiskBytes -= amount
      },
      release() {
        reservedDiskBytes -= remaining
        remaining = 0
      },
    }
  }

  const logJob = (entry) => {
    try {
      logger({
        jobId: entry.jobId,
        status: entry.status,
        durationMs: entry.durationMs ?? null,
        httpStatus: entry.httpStatus ?? null,
        upstreamRequestId: safeRequestId(entry.upstreamRequestId),
        attempt: entry.attempt ?? null,
        maxAttempts: entry.maxAttempts ?? null,
        retryReason: entry.retryReason ?? null,
        retryDelayMs: entry.retryDelayMs ?? null,
      })
    } catch {}
  }

  const publicJob = (row) => ({
    id: row.id,
    status: row.status,
    hasResult: Boolean(row.result_file),
    upstreamStatus: row.upstream_status ?? null,
    error: row.error_code ?? null,
    attemptCount: row.attempt_count ?? 0,
    maxAttempts: config.maxAttempts,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  })

  const requireJob = (id, token) => {
    const row = rowForId.get(id)
    if (!row) throw new HttpError(404, 'job_not_found')
    if (!isSameDigest(row.token_digest, hmac('task-token', token))) {
      throw new HttpError(403, 'invalid_task_token')
    }
    return row
  }

  const removeJobFiles = (row) => {
    removeFile(row.request_file)
    removeFile(row.headers_file)
    removeFile(row.result_file)
    removeFile(row.result_meta_file)
  }

  const removeInputFiles = (row) => {
    removeFileQuietly(row.request_file)
    removeFileQuietly(row.headers_file)
  }

  const cleanupOrphanFiles = () => {
    const referencedFiles = new Set(protectedFiles)
    for (const row of db.prepare('SELECT request_file, headers_file, result_file, result_meta_file FROM jobs').all()) {
      for (const file of [row.request_file, row.headers_file, row.result_file, row.result_meta_file]) {
        if (file) referencedFiles.add(path.resolve(file))
      }
    }
    for (const name of readdirSync(dataDir)) {
      if (!name.endsWith('.enc') && !name.includes('.tmp-')) continue
      const file = filePath(name)
      if (!referencedFiles.has(file)) removeFileQuietly(file)
    }
  }

  const cleanupExpired = () => {
    const now = Date.now()
    const rows = db.prepare(`
      SELECT * FROM jobs
      WHERE (status = 'succeeded' AND finished_at < ?)
         OR (status IN ('failed', 'unknown') AND finished_at < ?)
    `).all(now - config.successTtlMs, now - config.failureTtlMs)
    for (const row of rows) {
      transact(() => db.prepare('DELETE FROM jobs WHERE id = ? AND status = ?').run(row.id, row.status))
      for (const file of [row.request_file, row.headers_file, row.result_file, row.result_meta_file]) {
        removeFileQuietly(file)
      }
    }
  }

  const enqueue = (id) => {
    if (queuedIds.has(id) || closing) return
    queuedIds.add(id)
    queue.push(id)
    queueMicrotask(() => void pump())
  }

  const dispatch = async (id) => {
    const reservedAt = Date.now()
    const reserved = transact(() => db.prepare(`
      UPDATE jobs SET status = 'dispatch_reserved', updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(reservedAt, id))
    if (reserved.changes !== 1) return

    const row = rowForId.get(id)
    let startedAt = reservedAt
    let dispatched = false

    try {
      const forwarded = await readEncryptedJson(row.headers_file, key)
      const target = new URL(normalizeRequestedPath(row.upstream_path), upstream)
      const headers = {
        authorization: forwarded.authorization,
        'content-length': String(row.request_size),
        'idempotency-key': `image-job-${hmac('idempotency-key', id)}`,
      }
      if (forwarded.accept) headers.accept = forwarded.accept
      if (forwarded.contentType) headers['content-type'] = forwarded.contentType

      startedAt = Date.now()
      transact(() => db.prepare(`
        UPDATE jobs SET status = 'running', updated_at = ?, started_at = ?
        WHERE id = ? AND status = 'dispatch_reserved'
      `).run(startedAt, startedAt, id))
      for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
        const attemptStartedAt = Date.now()
        const controller = new AbortController()
        let timedOut = false
        let receivedResponse = false
        let resultTemp
        let resultMetaTemp
        const timeout = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, config.upstreamTimeoutMs)
        timeout.unref()
        dispatchControllers.set(id, controller)
        transact(() => db.prepare(`
          UPDATE jobs SET attempt_count = ?, updated_at = ?, upstream_status = NULL
          WHERE id = ? AND status = 'running'
        `).run(attempt, attemptStartedAt, id))

        try {
          dispatched = true
          const response = await postStream(target, headers, createDecryptedStream(row.request_file, key), controller.signal)
          receivedResponse = true
          const upstreamRequestId = safeRequestId(
            response.headers.get('x-request-id')
              || response.headers.get('request-id')
              || response.headers.get('openai-request-id'),
          )
          const rawContentType = response.headers.get('content-type') || 'application/octet-stream'
          const contentType = /^[\x20-\x7e]{1,1024}$/.test(rawContentType)
            ? rawContentType
            : 'application/octet-stream'
          const stem = jobFileStem(id)
          const resultFile = filePath(`${stem}.result.enc`)
          const resultMetaFile = filePath(`${stem}.result-meta.enc`)
          resultTemp = resultFile
          resultMetaTemp = resultMetaFile
          protectedFiles.add(resultFile)
          protectedFiles.add(resultMetaFile)
          const resultLengthHeader = response.headers.get('content-length')
          const resultLength = resultLengthHeader && /^\d+$/.test(resultLengthHeader)
            ? Number(resultLengthHeader)
            : null
          if (resultLength !== null && (!Number.isSafeInteger(resultLength) || resultLength > config.maxResultBytes)) {
            throw new HttpError(413, 'body_too_large')
          }
          const result = await writeEncryptedStream({
            readable: response.body,
            target: resultFile,
            key,
            maxBytes: config.maxResultBytes,
            checkDisk,
            reserveDisk,
            protectedFiles,
            expectedBytes: resultLength ?? config.maxResultBytes,
          })
          let upstreamErrorCode
          let hasNonRetryableMarker = false
          if (!response.ok && result.size <= 64 * 1024 && contentType.toLowerCase().includes('json')) {
            try {
              const payload = await readEncryptedJson(resultFile, key)
              const code = payload?.error?.code
                ?? payload?.error?.error_code
                ?? payload?.error_code
                ?? payload?.code
              upstreamErrorCode = typeof code === 'string' ? code : undefined
              const serialized = JSON.stringify(payload).toLowerCase()
              hasNonRetryableMarker = NON_RETRYABLE_UPSTREAM_MARKERS.some((marker) => serialized.includes(marker))
            } catch {}
          }
          const shouldRetryResponse = !hasNonRetryableMarker && (
            RETRYABLE_UPSTREAM_STATUSES.has(response.status)
            || Boolean(upstreamErrorCode && RETRYABLE_UPSTREAM_ERROR_CODES.has(upstreamErrorCode))
          )
          if (shouldRetryResponse && attempt < config.maxAttempts) {
            const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
            const retryDelayMs = Math.min(
              config.retryMaxDelayMs,
              retryAfterMs ?? config.retryBaseDelayMs * (2 ** (attempt - 1)),
            )
            removeFileQuietly(resultFile)
            transact(() => db.prepare(`
              UPDATE jobs SET updated_at = ?, upstream_status = ?
              WHERE id = ? AND status = 'running'
            `).run(Date.now(), response.status, id))
            logJob({
              jobId: id,
              status: 'retrying',
              durationMs: Date.now() - attemptStartedAt,
              httpStatus: response.status,
              upstreamRequestId,
              attempt,
              maxAttempts: config.maxAttempts,
              retryReason: upstreamErrorCode && RETRYABLE_UPSTREAM_ERROR_CODES.has(upstreamErrorCode)
                ? `upstream_${upstreamErrorCode}`
                : 'upstream_http_error',
              retryDelayMs,
            })
            if (retryDelayMs > 0) await wait(retryDelayMs)
            if (forceClosing) return
            continue
          }
          await writeEncryptedBuffer({
            target: resultMetaFile,
            key,
            checkDisk,
            reserveDisk,
            protectedFiles,
          }, Buffer.from(JSON.stringify({ contentType, upstreamRequestId })))
          const finishedAt = Date.now()
          const finalStatus = response.ok ? 'succeeded' : 'failed'
          const errorCode = response.ok ? null : 'upstream_http_error'
          transact(() => db.prepare(`
            UPDATE jobs
            SET status = ?, updated_at = ?, finished_at = ?, upstream_status = ?,
                result_file = ?, result_meta_file = ?, result_size = ?, result_digest = ?, error_code = ?,
                request_file = NULL, headers_file = NULL
            WHERE id = ? AND status = 'running'
          `).run(
            finalStatus,
            finishedAt,
            finishedAt,
            response.status,
            resultFile,
            resultMetaFile,
            result.size,
            result.digest,
            errorCode,
            id,
          ))
          removeInputFiles(row)
          logJob({
            jobId: id,
            status: finalStatus,
            durationMs: finishedAt - startedAt,
            httpStatus: response.status,
            upstreamRequestId,
            attempt,
            maxAttempts: config.maxAttempts,
          })
          return
        } catch (err) {
          if (resultTemp) removeFileQuietly(resultTemp)
          if (resultMetaTemp) removeFileQuietly(resultMetaTemp)
          if (forceClosing) return
          const isLocalResultError = err instanceof HttpError && ['body_too_large', 'disk_watermark_reached'].includes(err.code)
          if (!receivedResponse && !isLocalResultError && attempt < config.maxAttempts) {
            const retryDelayMs = Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * (2 ** (attempt - 1)))
            logJob({
              jobId: id,
              status: 'retrying',
              durationMs: Date.now() - attemptStartedAt,
              attempt,
              maxAttempts: config.maxAttempts,
              retryReason: timedOut ? 'upstream_timeout' : 'upstream_network',
              retryDelayMs,
            })
            if (retryDelayMs > 0) await wait(retryDelayMs)
            if (forceClosing) return
            continue
          }

          const finishedAt = Date.now()
          const errorCode = timedOut
            ? 'outcome_unknown_upstream_timeout'
            : err instanceof HttpError && err.code === 'body_too_large'
              ? 'outcome_unknown_response_too_large'
              : err instanceof HttpError && err.code === 'disk_watermark_reached'
                ? 'outcome_unknown_result_storage_full'
                : 'outcome_unknown_upstream_network'
          transact(() => db.prepare(`
            UPDATE jobs
            SET status = 'unknown', updated_at = ?, finished_at = ?, error_code = ?,
                request_file = NULL, headers_file = NULL
            WHERE id = ? AND status = 'running'
          `).run(finishedAt, finishedAt, errorCode, id))
          removeInputFiles(row)
          logJob({
            jobId: id,
            status: 'unknown',
            durationMs: finishedAt - startedAt,
            attempt,
            maxAttempts: config.maxAttempts,
          })
          return
        } finally {
          clearTimeout(timeout)
          dispatchControllers.delete(id)
          if (resultTemp) protectedFiles.delete(resultTemp)
          if (resultMetaTemp) protectedFiles.delete(resultMetaTemp)
        }
      }
    } catch (err) {
      if (forceClosing) return
      const finishedAt = Date.now()
      const finalStatus = dispatched ? 'unknown' : 'failed'
      const errorCode = dispatched
        ? 'outcome_unknown_upstream_network'
        : 'request_storage_error'
      transact(() => db.prepare(`
        UPDATE jobs
        SET status = ?, updated_at = ?, finished_at = ?, error_code = ?,
            request_file = NULL, headers_file = NULL
        WHERE id = ? AND status IN ('dispatch_reserved', 'running')
      `).run(finalStatus, finishedAt, finishedAt, errorCode, id))
      removeInputFiles(row)
      logJob({
        jobId: id,
        status: finalStatus,
        durationMs: finishedAt - startedAt,
      })
    }
  }

  async function pump() {
    if (pumping || closing) return
    pumping = true
    try {
      while (!closing && running < config.maxConcurrency && queue.length > 0) {
        const id = queue.shift()
        queuedIds.delete(id)
        if (statusForId.get(id)?.status !== 'queued') continue
        running += 1
        const promise = dispatch(id).catch(() => {}).finally(() => {
          running -= 1
          dispatchPromises.delete(promise)
          queueMicrotask(() => void pump())
        })
        dispatchPromises.add(promise)
      }
    } finally {
      pumping = false
    }
  }

  const handlePut = async (req, res, id, url, token) => {
    const tokenDigest = hmac('task-token', token)
    const existing = rowForId.get(id)
    if (existing) {
      req.resume()
      if (!isSameDigest(existing.token_digest, tokenDigest)) throw new HttpError(409, 'job_id_conflict')
      sendJson(res, 200, publicJob(existing))
      return
    }

    const currentReceive = receiving.get(id)
    if (currentReceive) {
      req.resume()
      if (!isSameDigest(currentReceive.tokenDigest, tokenDigest)) throw new HttpError(409, 'job_id_conflict')
      if (currentReceive.waiters >= config.maxWaitersPerJob) throw new HttpError(429, 'job_waiter_limit_reached')
      currentReceive.waiters += 1
      try {
        const row = await currentReceive.promise
        sendJson(res, 200, publicJob(row))
      } finally {
        currentReceive.waiters -= 1
      }
      return
    }

    const upstreamPath = normalizeRequestedPath(url.searchParams.get('path'))
    if ([...url.searchParams.keys()].some((name) => name !== 'path')) {
      throw new HttpError(400, 'unsupported_query_parameter')
    }
    const authorization = getHeader(req, 'authorization')
    if (!authorization || authorization.length > 16 * 1024) throw new HttpError(400, 'authorization_required')
    const contentType = getHeader(req, 'content-type')
    const accept = getHeader(req, 'accept')
    if ((contentType?.length || 0) > 1024 || (accept?.length || 0) > 1024) {
      throw new HttpError(400, 'invalid_forward_header')
    }
    const contentLengthHeader = getHeader(req, 'content-length')
    const contentLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : null
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength > config.maxBodyBytes)) {
      throw new HttpError(413, 'body_too_large')
    }
    checkDisk((contentLength ?? config.maxBodyBytes) + ENCRYPTED_FILE_HEADER_BYTES + AUTH_TAG_BYTES)

    const peerIp = normalizeIpAddress(req.socket.remoteAddress) || 'unknown'
    const forwarded = isTrustedProxyAddress(peerIp, config.trustedProxyCidrs)
      ? getHeader(req, 'x-forwarded-for') || getHeader(req, 'x-real-ip')
      : null
    const forwardedIps = forwarded?.split(',').map(normalizeIpAddress).filter(Boolean) ?? []
    let ip = peerIp
    for (let index = forwardedIps.length - 1; index >= 0; index -= 1) {
      ip = forwardedIps[index]
      if (!isTrustedProxyAddress(ip, config.trustedProxyCidrs)) break
    }
    const authDigest = hmac('authorization', authorization)
    const ipDigest = hmac('ip-address', ip)
    const receivingEntries = [...receiving.values()]
    if (queuedCount.get().count + receivingEntries.length >= config.maxQueue) {
      throw new HttpError(503, 'queue_full')
    }
    if (activeByAuth.get(authDigest).count + receivingEntries.filter((entry) => entry.authDigest === authDigest).length >= config.maxActivePerSubject) {
      throw new HttpError(429, 'key_active_limit_reached')
    }
    if (activeByIp.get(ipDigest).count + receivingEntries.filter((entry) => entry.ipDigest === ipDigest).length >= config.maxActivePerSubject) {
      throw new HttpError(429, 'ip_active_limit_reached')
    }

    let resolveReceive
    let rejectReceive
    const promise = new Promise((resolve, reject) => {
      resolveReceive = resolve
      rejectReceive = reject
    })
    promise.catch(() => {})
    receiving.set(id, { tokenDigest, authDigest, ipDigest, promise, waiters: 0, createdAt: Date.now() })

    const stem = jobFileStem(id)
    const requestFile = filePath(`${stem}.request.enc`)
    const headersFile = filePath(`${stem}.headers.enc`)
    protectedFiles.add(requestFile)
    protectedFiles.add(headersFile)
    try {
      const request = await writeEncryptedStream({
        readable: req,
        target: requestFile,
        key,
        maxBytes: config.maxBodyBytes,
        checkDisk,
        reserveDisk,
        protectedFiles,
        expectedBytes: contentLength ?? config.maxBodyBytes,
      })
      await writeEncryptedBuffer({
        target: headersFile,
        key,
        checkDisk,
        reserveDisk,
        protectedFiles,
      }, Buffer.from(JSON.stringify({ authorization, contentType, accept })))
      const now = Date.now()
      transact(() => db.prepare(`
        INSERT INTO jobs (
          id, token_digest, auth_digest, ip_digest, upstream_path,
          request_file, headers_file, request_size, request_digest,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
      `).run(
        id,
        tokenDigest,
        authDigest,
        ipDigest,
        upstreamPath,
        requestFile,
        headersFile,
        request.size,
        request.digest,
        now,
        now,
      ))
      const row = rowForId.get(id)
      resolveReceive(row)
      sendJson(res, 202, publicJob(row))
      enqueue(id)
    } catch (err) {
      removeFileQuietly(requestFile)
      removeFileQuietly(headersFile)
      rejectReceive(err)
      throw err
    } finally {
      receiving.delete(id)
      protectedFiles.delete(requestFile)
      protectedFiles.delete(headersFile)
    }
  }

  const handleRequest = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://image-job-proxy.local')
      if (req.method === 'GET' && url.pathname === '/healthz') {
        checkDisk()
        sendJson(res, 200, {
          ok: true,
          queued: queuedCount.get().count,
          running,
        })
        return
      }

      const resultImageMatch = url.pathname.match(/^\/v1\/jobs\/([A-Za-z0-9_-]{20,128})\/result-images\/(\d{1,4})$/)
      const match = url.pathname.match(/^\/v1\/jobs\/([A-Za-z0-9_-]{20,128})(?:\/(result))?$/)
      if (!match && !resultImageMatch) throw new HttpError(404, 'not_found')
      const id = resultImageMatch?.[1] ?? match[1]
      const resultRoute = match?.[2] === 'result'
      const resultImageIndex = resultImageMatch ? Number(resultImageMatch[2]) : null
      const token = getHeader(req, 'x-task-token')
      if (!token || token.length < 16 || token.length > 512) throw new HttpError(401, 'task_token_required')

      if (req.method === 'PUT' && !resultRoute && resultImageIndex === null) {
        await handlePut(req, res, id, url, token)
        return
      }

      if (url.search) throw new HttpError(400, 'unsupported_query_parameter')
      if (req.method === 'GET' && !resultRoute && resultImageIndex === null) {
        const row = rowForId.get(id)
        if (row) {
          if (!isSameDigest(row.token_digest, hmac('task-token', token))) {
            throw new HttpError(403, 'invalid_task_token')
          }
          sendJson(res, 200, publicJob(row))
          return
        }
        const currentReceive = receiving.get(id)
        if (!currentReceive) throw new HttpError(404, 'job_not_found')
        if (!isSameDigest(currentReceive.tokenDigest, hmac('task-token', token))) {
          throw new HttpError(403, 'invalid_task_token')
        }
        sendJson(res, 200, {
          id,
          status: 'receiving',
          hasResult: false,
          upstreamStatus: null,
          error: null,
          createdAt: toIso(currentReceive.createdAt),
          updatedAt: toIso(currentReceive.createdAt),
          startedAt: null,
          finishedAt: null,
        })
        return
      }

      const row = requireJob(id, token)
      if (req.method === 'GET' && resultImageIndex !== null) {
        if (!row.result_file || !row.result_meta_file) throw new HttpError(409, 'result_not_available')
        const meta = await readEncryptedJson(row.result_meta_file, key)
        if (!String(meta.contentType || '').toLowerCase().includes('json')) {
          throw new HttpError(404, 'result_image_not_available')
        }
        const payload = await readEncryptedJson(row.result_file, key, Math.min(config.maxResultBytes, 1024 * 1024))
        const imageUrl = payload?.data?.[resultImageIndex]?.url
        if (typeof imageUrl !== 'string') throw new HttpError(404, 'result_image_not_available')

        let target
        try {
          target = new URL(imageUrl)
        } catch {
          throw new HttpError(502, 'invalid_result_image_url')
        }
        const host = target.hostname.toLowerCase()
        if (
          !['http:', 'https:'].includes(target.protocol)
          || target.username
          || target.password
          || target.hash
          || !isAllowedResultImageHost(host, config.resultImageHosts)
        ) {
          throw new HttpError(502, 'result_image_host_not_allowed')
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), config.resultImageTimeoutMs)
        timeout.unref()
        const abortOnClose = () => {
          if (!res.writableEnded) controller.abort()
        }
        res.once('close', abortOnClose)
        try {
          const response = await fetch(target, { redirect: 'manual', signal: controller.signal })
          if (!response.ok || !response.body) throw new HttpError(502, 'result_image_download_failed')
          const contentType = response.headers.get('content-type') || 'application/octet-stream'
          if (!contentType.toLowerCase().startsWith('image/')) throw new HttpError(502, 'invalid_result_image_type')
          const lengthHeader = response.headers.get('content-length')
          const length = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null
          if (length !== null && (!Number.isSafeInteger(length) || length > config.maxResultBytes)) {
            throw new HttpError(413, 'result_image_too_large')
          }

          let size = 0
          const limiter = new Transform({
            transform(chunk, _encoding, callback) {
              size += chunk.length
              if (size > config.maxResultBytes) {
                callback(new HttpError(413, 'result_image_too_large'))
                return
              }
              callback(null, chunk)
            },
          })
          res.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': contentType,
            ...(length !== null ? { 'content-length': length } : {}),
          })
          await pipeline(Readable.fromWeb(response.body), limiter, res)
        } finally {
          clearTimeout(timeout)
          res.off('close', abortOnClose)
        }
        return
      }

      if (req.method === 'GET' && resultRoute) {
        if (!row.result_file || !row.result_meta_file) {
          throw new HttpError(409, 'result_not_available')
        }
        const meta = await readEncryptedJson(row.result_meta_file, key)
        res.writeHead(row.upstream_status, {
          'cache-control': 'no-store',
          'content-length': row.result_size,
          'content-type': meta.contentType || 'application/octet-stream',
          ...(meta.upstreamRequestId ? { 'x-upstream-request-id': meta.upstreamRequestId } : {}),
        })
        await pipeline(createDecryptedStream(row.result_file, key), res)
        return
      }

      if (req.method === 'DELETE' && !resultRoute) {
        if (!TERMINAL_STATUSES.has(row.status)) throw new HttpError(409, 'job_still_active')
        transact(() => db.prepare('DELETE FROM jobs WHERE id = ? AND status = ?').run(id, row.status))
        removeJobFiles(row)
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
        return
      }

      throw new HttpError(405, 'method_not_allowed')
    } catch (err) {
      if (req.method === 'PUT' && !req.readableEnded) req.resume()
      if (res.headersSent) {
        res.destroy()
        return
      }
      const status = err instanceof HttpError ? err.status : 500
      const code = err instanceof HttpError ? err.code : 'internal_error'
      sendJson(res, status, { error: code })
    }
  }

  const now = Date.now()
  const interrupted = db.prepare("SELECT id, request_file, headers_file FROM jobs WHERE status IN ('dispatch_reserved', 'running')").all()
  if (interrupted.length > 0) {
    transact(() => db.prepare(`
      UPDATE jobs
      SET status = 'unknown', updated_at = ?, finished_at = ?, error_code = 'outcome_unknown_after_restart',
          request_file = NULL, headers_file = NULL
      WHERE status IN ('dispatch_reserved', 'running')
    `).run(now, now))
    for (const row of interrupted) {
      removeInputFiles(row)
      logJob({ jobId: row.id, status: 'unknown' })
    }
  }

  cleanupExpired()
  cleanupOrphanFiles()
  for (const row of db.prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at").all()) enqueue(row.id)

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch(() => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      try {
        sendJson(res, 500, { error: 'internal_error' })
      } catch {
        res.destroy()
      }
    })
  })
  server.requestTimeout = config.ingestTimeoutMs
  server.headersTimeout = 60_000
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  })

  const listen = () => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => {
      server.off('error', reject)
      cleanupTimer = setInterval(() => {
        try {
          cleanupExpired()
        } catch {}
        try {
          cleanupOrphanFiles()
        } catch {}
      }, config.cleanupIntervalMs)
      cleanupTimer.unref()
      resolve(server.address())
    })
  })

  const close = async ({ force = false } = {}) => {
    if (closing) return
    closing = true
    if (cleanupTimer) clearInterval(cleanupTimer)
    await new Promise((resolve) => server.close(() => resolve()))
    if (force) {
      forceClosing = true
      for (const controller of dispatchControllers.values()) controller.abort()
    }
    await Promise.allSettled([...dispatchPromises])
    db.close()
  }

  return {
    close,
    config,
    dataDir,
    dbPath,
    listen,
    server,
  }
}
