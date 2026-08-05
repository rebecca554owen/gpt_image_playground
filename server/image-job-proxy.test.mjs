import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, test } from 'node:test'

import { createImageJobProxy } from './image-job-proxy.mjs'

const fixtures = []

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject)
    resolve(server.address())
  })
})

const closeServer = (server) => new Promise((resolve) => {
  server.close(() => resolve())
  server.closeAllConnections?.()
})

const createFixture = async (handler, overrides = {}, customLogger) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'image-jobs-test-'))
  const upstream = http.createServer(handler)
  const upstreamAddress = await listen(upstream)
  const logs = []
  const env = {
    IMAGE_JOB_CLEANUP_INTERVAL_MS: '60000',
    IMAGE_JOB_DATA_DIR: dataDir,
    IMAGE_JOB_DISK_MIN_FREE_BYTES: '0',
    IMAGE_JOB_DISK_MIN_FREE_PERCENT: '0',
    IMAGE_JOB_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    IMAGE_JOB_FAILURE_TTL_MS: '60000',
    IMAGE_JOB_HOST: '127.0.0.1',
    IMAGE_JOB_MAX_ACTIVE_PER_SUBJECT: '20',
    IMAGE_JOB_MAX_BODY_BYTES: String(4 * 1024 * 1024),
    IMAGE_JOB_MAX_CONCURRENCY: '4',
    IMAGE_JOB_MAX_QUEUE: '100',
    IMAGE_JOB_MAX_RESULT_BYTES: String(4 * 1024 * 1024),
    IMAGE_JOB_PORT: '0',
    IMAGE_JOB_RETRY_BASE_DELAY_MS: '1',
    IMAGE_JOB_RETRY_MAX_DELAY_MS: '5',
    IMAGE_JOB_SUCCESS_TTL_MS: '60000',
    IMAGE_JOB_UPSTREAM_TIMEOUT_MS: '5000',
    IMAGE_JOB_UPSTREAM_URL: `http://127.0.0.1:${upstreamAddress.port}/v1`,
    ...overrides,
  }
  const proxy = createImageJobProxy({
    env,
    logger: (entry) => {
      logs.push(entry)
      customLogger?.(entry)
    },
  })
  const proxyAddress = await proxy.listen()
  const fixture = {
    baseUrl: `http://127.0.0.1:${proxyAddress.port}`,
    dataDir,
    env,
    logs,
    proxy,
    upstream,
  }
  fixtures.push(fixture)
  return fixture
}

const stopFixture = async (fixture) => {
  const idx = fixtures.indexOf(fixture)
  if (idx >= 0) fixtures.splice(idx, 1)
  if (fixture.proxy) await fixture.proxy.close()
  await closeServer(fixture.upstream)
  rmSync(fixture.dataDir, { force: true, recursive: true })
}

afterEach(async () => {
  while (fixtures.length > 0) await stopFixture(fixtures[0])
})

const requestHeaders = (token, authorization = 'Bearer test-api-key') => ({
  accept: 'application/json',
  authorization,
  'content-type': 'application/json',
  'x-task-token': token,
})

const putJob = (fixture, { id = randomUUID(), token = randomUUID(), body = '{"prompt":"test"}', upstreamPath = 'images/generations', authorization } = {}) => fetch(
  `${fixture.baseUrl}/v1/jobs/${id}?path=${encodeURIComponent(upstreamPath)}`,
  {
    method: 'PUT',
    headers: requestHeaders(token, authorization),
    body,
  },
)

const getJob = (fixture, id, token) => fetch(`${fixture.baseUrl}/v1/jobs/${id}`, {
  headers: { 'x-task-token': token },
})

const waitForTerminal = async (fixture, id, token) => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const response = await getJob(fixture, id, token)
    assert.equal(response.status, 200)
    const job = await response.json()
    if (['succeeded', 'failed', 'unknown'].includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('job did not reach a terminal state')
}

const readRequest = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

test('相同 job id 和 token 只提交一次上游', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    await readRequest(req)
    await new Promise((resolve) => setTimeout(resolve, 80))
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-idempotent' })
    res.end('{"data":[{"b64_json":"result"}]}')
  })
  const id = randomUUID()
  const token = randomUUID()
  const first = await putJob(fixture, { id, token, body: '{"prompt":"first"}' })
  const duplicate = await putJob(fixture, { id, token, body: '{"prompt":"must-not-send"}' })

  assert.equal(first.status, 202)
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).id, id)
  const job = await waitForTerminal(fixture, id, token)
  assert.equal(job.status, 'succeeded')
  assert.equal(upstreamCalls, 1)
})

test('首次请求仍在接收时重复 PUT 会排空副本请求体并复用同一任务', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    await readRequest(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  }, { IMAGE_JOB_MAX_WAITERS_PER_JOB: '1' })
  const id = randomUUID()
  const token = randomUUID()
  const target = new URL(`${fixture.baseUrl}/v1/jobs/${id}?path=images%2Fgenerations`)
  const firstBody = Buffer.alloc(128 * 1024, 'a')
  const firstResponse = new Promise((resolve, reject) => {
    const req = http.request(target, {
      method: 'PUT',
      headers: {
        ...requestHeaders(token),
        'content-length': firstBody.length,
      },
    })
    req.once('error', reject)
    req.once('response', async (res) => {
      const chunks = []
      for await (const chunk of res) chunks.push(chunk)
      resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
    })
    req.write(firstBody.subarray(0, 1024))
    setTimeout(() => req.end(firstBody.subarray(1024)), 80)
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  const receiving = await getJob(fixture, id, token)
  assert.equal(receiving.status, 200)
  assert.equal((await receiving.json()).status, 'receiving')
  const forbidden = await getJob(fixture, id, randomUUID())
  assert.equal(forbidden.status, 403)
  assert.deepEqual(await forbidden.json(), { error: 'invalid_task_token' })
  const duplicatePromise = putJob(fixture, {
    id,
    token,
    body: '{"prompt":"duplicate-body-is-discarded"}',
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  const overflow = await putJob(fixture, {
    id,
    token,
    body: '{"prompt":"too-many-waiters"}',
  })
  const duplicate = await duplicatePromise
  const first = await firstResponse
  assert.equal(first.status, 202)
  assert.equal(duplicate.status, 200)
  assert.equal(overflow.status, 429)
  assert.deepEqual(await overflow.json(), { error: 'job_waiter_limit_reached' })
  assert.equal((await duplicate.json()).id, id)
  assert.equal((await waitForTerminal(fixture, id, token)).status, 'succeeded')
  assert.equal(upstreamCalls, 1)
})

test('损坏的结果密文只中断当前下载且任务代理保持可用', async () => {
  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"data":[{"b64_json":"result"}]}')
  })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)
  assert.equal((await waitForTerminal(fixture, id, token)).status, 'succeeded')

  const db = new DatabaseSync(path.join(fixture.dataDir, 'jobs.sqlite'))
  const row = db.prepare('SELECT result_file FROM jobs WHERE id = ?').get(id)
  db.close()
  writeFileSync(row.result_file, 'corrupted-result')

  const result = await fetch(`${fixture.baseUrl}/v1/jobs/${id}/result`, {
    headers: { 'x-task-token': token },
  }).catch(() => null)
  if (result) await assert.rejects(result.arrayBuffer())

  const health = await fetch(`${fixture.baseUrl}/healthz`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).ok, true)
})

test('结果下载与终态删除并发时任务代理保持可用', async () => {
  const expected = Buffer.alloc(3 * 1024 * 1024, 'r')
  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(expected)
  })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)
  assert.equal((await waitForTerminal(fixture, id, token)).status, 'succeeded')

  const downloaded = await new Promise((resolve, reject) => {
    const req = http.get(`${fixture.baseUrl}/v1/jobs/${id}/result`, {
      headers: { 'x-task-token': token },
    }, (res) => {
      const chunks = []
      res.pause()
      res.on('data', (chunk) => chunks.push(chunk))
      res.once('error', reject)
      res.once('end', () => resolve(Buffer.concat(chunks)))
      void fetch(`${fixture.baseUrl}/v1/jobs/${id}`, {
        method: 'DELETE',
        headers: { 'x-task-token': token },
      }).then((response) => {
        assert.equal(response.status, 204)
        res.resume()
      }, reject)
    })
    req.once('error', reject)
  })
  assert.deepEqual(downloaded, expected)

  const health = await fetch(`${fixture.baseUrl}/healthz`)
  assert.equal(health.status, 200)
})

test('周期清理会重试暂时无法删除的孤立密文', async () => {
  const fixture = await createFixture((_req, res) => res.end('{}'), {
    IMAGE_JOB_CLEANUP_INTERVAL_MS: '100',
  })
  const orphan = path.join(fixture.dataDir, 'orphan.result.enc')
  mkdirSync(orphan)
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(existsSync(orphan), true)

  rmSync(orphan, { recursive: true })
  writeFileSync(orphan, 'orphaned-encrypted-data')
  const orphanTemp = path.join(fixture.dataDir, 'orphan.request.enc.tmp-dead-process')
  writeFileSync(orphanTemp, 'orphaned-encrypted-temp-data')
  const deadline = Date.now() + 2000
  while ((existsSync(orphan) || existsSync(orphanTemp)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(existsSync(orphan), false)
  assert.equal(existsSync(orphanTemp), false)
})

test('客户端结束提交连接后后台继续并可稍后取回结果', async () => {
  const expected = Buffer.from('generated-image-bytes')
  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    await new Promise((resolve) => setTimeout(resolve, 150))
    res.writeHead(200, { 'content-type': 'image/png', 'x-request-id': 'req-detached' })
    res.end(expected)
  })
  const id = randomUUID()
  const token = randomUUID()
  const target = new URL(`${fixture.baseUrl}/v1/jobs/${id}?path=images%2Fgenerations`)

  await new Promise((resolve, reject) => {
    const req = http.request(target, {
      method: 'PUT',
      headers: {
        ...requestHeaders(token),
        'content-length': Buffer.byteLength('{"prompt":"detached"}'),
      },
    })
    req.once('error', reject)
    req.once('response', (res) => {
      assert.equal(res.statusCode, 202)
      res.destroy()
      resolve()
    })
    req.end('{"prompt":"detached"}')
  })

  const job = await waitForTerminal(fixture, id, token)
  assert.equal(job.status, 'succeeded')
  const result = await fetch(`${fixture.baseUrl}/v1/jobs/${id}/result`, {
    headers: { 'x-task-token': token },
  })
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), expected)
})

test('正常关闭会停止接单并等待已派发任务完成', async () => {
  let upstreamFinished = false
  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    await new Promise((resolve) => setTimeout(resolve, 120))
    upstreamFinished = true
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)

  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const job = await (await getJob(fixture, id, token)).json()
    if (job.status === 'running') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await fixture.proxy.close()
  fixture.proxy = null
  assert.equal(upstreamFinished, true)

  const db = new DatabaseSync(path.join(fixture.dataDir, 'jobs.sqlite'))
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get(id).status, 'succeeded')
  db.close()
})

test('重试预算为一次时上游超时进入 unknown 并立即清理请求与凭据', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    await readRequest(req)
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (!res.destroyed) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    }
  }, {
    IMAGE_JOB_MAX_ATTEMPTS: '1',
    IMAGE_JOB_UPSTREAM_TIMEOUT_MS: '100',
  })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)

  const job = await waitForTerminal(fixture, id, token)
  assert.equal(job.status, 'unknown')
  assert.equal(job.error, 'outcome_unknown_upstream_timeout')
  assert.equal(job.hasResult, false)
  const duplicate = await putJob(fixture, { id, token, body: '{"prompt":"do-not-retry"}' })
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).status, 'unknown')
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert.equal(upstreamCalls, 1)

  const db = new DatabaseSync(path.join(fixture.dataDir, 'jobs.sqlite'))
  const stored = db.prepare('SELECT request_file, headers_file FROM jobs WHERE id = ?').get(id)
  assert.equal(stored.request_file, null)
  assert.equal(stored.headers_file, null)
  db.close()
  assert.equal(readdirSync(fixture.dataDir).some((name) => name.endsWith('.request.enc') || name.endsWith('.headers.enc')), false)
})

test('logger 抛错不会破坏已提交的成功结果', async () => {
  const expected = Buffer.from('logger-safe-result')
  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(expected)
  }, {}, () => {
    throw new Error('logger unavailable')
  })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)
  assert.equal((await waitForTerminal(fixture, id, token)).status, 'succeeded')

  const result = await fetch(`${fixture.baseUrl}/v1/jobs/${id}/result`, {
    headers: { 'x-task-token': token },
  })
  assert.equal(result.status, 200)
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), expected)
})

test('临时 HTTP 错误在同一任务内重试并复用请求体和幂等键', async () => {
  const bodies = []
  const idempotencyKeys = []
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    bodies.push((await readRequest(req)).toString('utf8'))
    idempotencyKeys.push(req.headers['idempotency-key'])
    if (upstreamCalls === 1) {
      res.writeHead(502, { 'content-type': 'application/json', 'x-request-id': 'req-retry-first' })
      res.end('{"error":"temporary"}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-retry-success' })
    res.end('{"data":[{"b64_json":"result"}]}')
  })
  const id = randomUUID()
  const token = randomUUID()
  const body = '{"prompt":"same-request"}'
  assert.equal((await putJob(fixture, { id, token, body })).status, 202)

  const job = await waitForTerminal(fixture, id, token)
  assert.equal(job.status, 'succeeded')
  assert.equal(job.attemptCount, 2)
  assert.equal(job.maxAttempts, 2)
  assert.equal(upstreamCalls, 2)
  assert.deepEqual(bodies, [body, body])
  assert.equal(idempotencyKeys[0], idempotencyKeys[1])
  assert.match(idempotencyKeys[0], /^image-job-[a-f0-9]{64}$/)
  assert.equal(fixture.logs.find((entry) => entry.status === 'retrying')?.httpStatus, 502)
})

test('上游未返回响应时重试一次并取回最终结果', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    await readRequest(req)
    if (upstreamCalls === 1) {
      req.socket.destroy()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)

  const job = await waitForTerminal(fixture, id, token)
  assert.equal(job.status, 'succeeded')
  assert.equal(job.attemptCount, 2)
  assert.equal(upstreamCalls, 2)
  assert.equal(fixture.logs.find((entry) => entry.status === 'retrying')?.retryReason, 'upstream_network')
})

test('上游首次超时后在同一任务内重试成功', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    const call = ++upstreamCalls
    await readRequest(req)
    if (call === 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (!res.destroyed) res.end('{"late":true}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  }, { IMAGE_JOB_UPSTREAM_TIMEOUT_MS: '100' })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)

  const job = await waitForTerminal(fixture, id, token)
  assert.equal(job.status, 'succeeded')
  assert.equal(job.attemptCount, 2)
  assert.equal(upstreamCalls, 2)
  assert.equal(fixture.logs.find((entry) => entry.status === 'retrying')?.retryReason, 'upstream_timeout')
})

test('400、401 和 403 确定性错误不会重试', async () => {
  for (const status of [400, 401, 403]) {
    let upstreamCalls = 0
    const fixture = await createFixture(async (req, res) => {
      upstreamCalls += 1
      await readRequest(req)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end('{"error":"terminal"}')
    }, { IMAGE_JOB_MAX_ATTEMPTS: '3' })
    const id = randomUUID()
    const token = randomUUID()
    assert.equal((await putJob(fixture, { id, token })).status, 202)
    const job = await waitForTerminal(fixture, id, token)
    assert.equal(job.status, 'failed', `HTTP ${status}: ${JSON.stringify(job)}`)
    assert.equal(job.upstreamStatus, status)
    assert.equal(job.attemptCount, 1)
    assert.equal(upstreamCalls, 1)
  }
})

test('400 image_stream_timeout 按临时上游故障重试', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    await readRequest(req)
    res.writeHead(upstreamCalls === 1 ? 400 : 200, { 'content-type': 'application/json' })
    res.end(upstreamCalls === 1
      ? '{"error":{"code":"image_stream_timeout","message":"try again"}}'
      : '{"ok":true}')
  })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)

  const job = await waitForTerminal(fixture, id, token)
  assert.equal(job.status, 'succeeded')
  assert.equal(job.attemptCount, 2)
  assert.equal(upstreamCalls, 2)
  assert.equal(fixture.logs.find((entry) => entry.status === 'retrying')?.retryReason, 'upstream_image_stream_timeout')
})

test('503 image_unsafe 安全审核结果不会重试', async () => {
  let upstreamCalls = 0
  const expected = '{"error":{"message":"poll failed: 451 {\\"error_code\\":\\"image_unsafe\\"}"}}'
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    await readRequest(req)
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(expected)
  }, { IMAGE_JOB_MAX_ATTEMPTS: '3' })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)

  const job = await waitForTerminal(fixture, id, token)
  assert.equal(job.status, 'failed')
  assert.equal(job.upstreamStatus, 503)
  assert.equal(job.attemptCount, 1)
  assert.equal(upstreamCalls, 1)
  const result = await fetch(`${fixture.baseUrl}/v1/jobs/${id}/result`, {
    headers: { 'x-task-token': token },
  })
  assert.equal(result.status, 503)
  assert.equal(await result.text(), expected)
})

test('重启后 queued 密文可恢复派发，已运行任务只变 unknown', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    const body = (await readRequest(req)).toString('utf8')
    if (body.includes('hold-running')) {
      await new Promise(() => {})
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  }, { IMAGE_JOB_MAX_CONCURRENCY: '1' })
  const runningJob = { id: randomUUID(), token: randomUUID() }
  const queuedJob = { id: randomUUID(), token: randomUUID() }
  assert.equal((await putJob(fixture, { ...runningJob, body: '{"prompt":"hold-running"}' })).status, 202)

  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const job = await (await getJob(fixture, runningJob.id, runningJob.token)).json()
    if (job.status === 'running') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal((await putJob(fixture, { ...queuedJob, body: '{"prompt":"resume-queued"}' })).status, 202)
  await fixture.proxy.close({ force: true })
  fixture.proxy = null

  const restarted = createImageJobProxy({ env: fixture.env, logger: () => {} })
  const address = await restarted.listen()
  fixture.proxy = restarted
  fixture.baseUrl = `http://127.0.0.1:${address.port}`
  const unknown = await (await getJob(fixture, runningJob.id, runningJob.token)).json()
  assert.equal(unknown.status, 'unknown')
  assert.equal((await waitForTerminal(fixture, queuedJob.id, queuedJob.token)).status, 'succeeded')
  assert.equal(upstreamCalls, 2)
})

test('旧任务数据库启动时自动补充重试次数字段', async () => {
  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  await fixture.proxy.close()
  fixture.proxy = null
  const db = new DatabaseSync(path.join(fixture.dataDir, 'jobs.sqlite'))
  db.exec('ALTER TABLE jobs DROP COLUMN attempt_count')
  assert.equal(db.prepare('PRAGMA table_info(jobs)').all().some((column) => column.name === 'attempt_count'), false)
  db.close()

  const restarted = createImageJobProxy({ env: fixture.env, logger: () => {} })
  const address = await restarted.listen()
  fixture.proxy = restarted
  fixture.baseUrl = `http://127.0.0.1:${address.port}`
  const migrated = new DatabaseSync(path.join(fixture.dataDir, 'jobs.sqlite'))
  assert.equal(migrated.prepare('PRAGMA table_info(jobs)').all().some((column) => column.name === 'attempt_count'), true)
  migrated.close()
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)
  assert.equal((await waitForTerminal(fixture, id, token)).attemptCount, 1)
})

test('task token 隔离任务且冲突 token 不能复用 job id', async () => {
  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  const id = randomUUID()
  const ownerToken = randomUUID()
  const otherToken = randomUUID()
  assert.equal((await putJob(fixture, { id, token: ownerToken })).status, 202)

  const isolated = await getJob(fixture, id, otherToken)
  assert.equal(isolated.status, 403)
  assert.deepEqual(await isolated.json(), { error: 'invalid_task_token' })
  const conflict = await putJob(fixture, { id, token: otherToken })
  assert.equal(conflict.status, 409)
  assert.deepEqual(await conflict.json(), { error: 'job_id_conflict' })
})

test('上游 HTTP 错误状态、类型和响应体原样取回', async () => {
  const expected = Buffer.from('{"error":{"code":"rate_limit","message":"try later"}}')
  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    res.writeHead(429, { 'content-type': 'application/problem+json', 'x-request-id': 'req-rate-limited' })
    res.end(expected)
  })
  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)

  const job = await waitForTerminal(fixture, id, token)
  assert.equal(job.status, 'failed')
  assert.equal(job.hasResult, true)
  assert.equal(job.upstreamStatus, 429)
  assert.equal(job.error, 'upstream_http_error')
  const result = await fetch(`${fixture.baseUrl}/v1/jobs/${id}/result`, {
    headers: { 'x-task-token': token },
  })
  assert.equal(result.status, 429)
  assert.equal(result.headers.get('content-type'), 'application/problem+json')
  assert.equal(result.headers.get('x-upstream-request-id'), 'req-rate-limited')
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), expected)
})

test('请求体超限和磁盘低水位都在调用上游前拒绝', async () => {
  let upstreamCalls = 0
  const oversized = await createFixture((_req, res) => {
    upstreamCalls += 1
    res.end('{}')
  }, { IMAGE_JOB_MAX_BODY_BYTES: '8' })
  const oversizedResponse = await putJob(oversized, { body: '{"prompt":"too-large"}' })
  assert.equal(oversizedResponse.status, 413)
  assert.deepEqual(await oversizedResponse.json(), { error: 'body_too_large' })
  assert.equal(upstreamCalls, 0)

  const diskLimited = await createFixture((_req, res) => {
    upstreamCalls += 1
    res.end('{}')
  }, { IMAGE_JOB_DISK_MIN_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) })
  const diskResponse = await putJob(diskLimited)
  assert.equal(diskResponse.status, 507)
  assert.deepEqual(await diskResponse.json(), { error: 'disk_watermark_reached' })
  assert.equal(upstreamCalls, 0)
})

test('健康检查可用且只有终态任务可以删除', async () => {
  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    await new Promise((resolve) => setTimeout(resolve, 120))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  const health = await fetch(`${fixture.baseUrl}/healthz`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).ok, true)

  const id = randomUUID()
  const token = randomUUID()
  assert.equal((await putJob(fixture, { id, token })).status, 202)
  const activeDelete = await fetch(`${fixture.baseUrl}/v1/jobs/${id}`, {
    method: 'DELETE',
    headers: { 'x-task-token': token },
  })
  assert.equal(activeDelete.status, 409)
  assert.deepEqual(await activeDelete.json(), { error: 'job_still_active' })

  assert.equal((await waitForTerminal(fixture, id, token)).status, 'succeeded')
  const terminalDelete = await fetch(`${fixture.baseUrl}/v1/jobs/${id}`, {
    method: 'DELETE',
    headers: { 'x-task-token': token },
  })
  assert.equal(terminalDelete.status, 204)
  assert.equal((await getJob(fixture, id, token)).status, 404)
})

test('每个 API key 的活跃任务上限不会挤入额外上游请求', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    await readRequest(req)
    await new Promise((resolve) => setTimeout(resolve, 120))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  }, { IMAGE_JOB_MAX_ACTIVE_PER_SUBJECT: '1' })
  const authorization = 'Bearer shared-fake-key'
  const first = { id: randomUUID(), token: randomUUID() }
  assert.equal((await putJob(fixture, { ...first, authorization })).status, 202)
  const limited = await putJob(fixture, {
    id: randomUUID(),
    token: randomUUID(),
    authorization,
  })
  assert.equal(limited.status, 429)
  assert.deepEqual(await limited.json(), { error: 'key_active_limit_reached' })
  assert.equal((await waitForTerminal(fixture, first.id, first.token)).status, 'succeeded')
  assert.equal(upstreamCalls, 1)
})

test('任务代理镜像保持非 root、健康检查和持久卷配置', () => {
  const dockerfile = readFileSync(path.join(process.cwd(), 'deploy/task-proxy.Dockerfile'), 'utf8')
  assert.match(dockerfile, /^FROM node:24-alpine/m)
  assert.match(dockerfile, /addgroup -S -g 10001 imagejobs/)
  assert.match(dockerfile, /adduser -S -D -H -u 10001 -G imagejobs imagejobs/)
  assert.match(dockerfile, /^USER 10001:10001/m)
  assert.match(dockerfile, /^VOLUME \["\/var\/lib\/image-jobs"\]/m)
  assert.match(dockerfile, /^HEALTHCHECK /m)
  assert.match(dockerfile, /\/healthz/)
  assert.doesNotMatch(dockerfile, /COPY[^\n]*image-job-proxy\.test\.mjs/)
})

test('部署配置使用 secret 文件、回环端口和可信 Docker 代理链', () => {
  const compose = readFileSync(path.join(process.cwd(), 'deploy/docker-compose.image-jobs.yml'), 'utf8')
  const nginx = readFileSync(path.join(process.cwd(), 'deploy/nginx.conf'), 'utf8')
  const readme = readFileSync(path.join(process.cwd(), 'README.md'), 'utf8')
  const settingsModal = readFileSync(path.join(process.cwd(), 'src/components/SettingsModal.tsx'), 'utf8')
  assert.match(compose, /IMAGE_JOB_ENCRYPTION_KEY_FILE: \/run\/secrets\/image_job_encryption_key/)
  assert.match(compose, /DEFAULT_API_URL: \$\{DEFAULT_API_URL:-https:\/\/api\.llm-token\.cn\/v1\}/)
  assert.match(compose, /LOCK_API_PROXY: 'true'/)
  assert.match(compose, /container_name: image-gpt-image-playground/)
  assert.match(compose, /container_name: image-gpt-image-task-proxy/)
  assert.doesNotMatch(compose, /^\s+IMAGE_JOB_ENCRYPTION_KEY:/m)
  assert.match(compose, /^\s+secrets:\n\s+- image_job_encryption_key/m)
  assert.match(compose, /IMAGE_JOB_TRUST_PROXY_CIDRS: [^\n]*172\.16\.0\.0\/12/)
  assert.match(compose, /IMAGE_JOB_MAX_ATTEMPTS: \$\{IMAGE_JOB_MAX_ATTEMPTS:-2\}/)
  assert.match(compose, /IMAGE_JOB_RETRY_BASE_DELAY_MS: \$\{IMAGE_JOB_RETRY_BASE_DELAY_MS:-2000\}/)
  assert.match(compose, /IMAGE_JOB_RETRY_MAX_DELAY_MS: \$\{IMAGE_JOB_RETRY_MAX_DELAY_MS:-60000\}/)
  assert.match(compose, /stop_grace_period: 41m/)
  assert.match(compose, /'127\.0\.0\.1:\$\{IMAGE_SITE_PORT:-8080\}:80'/)
  assert.doesNotMatch(compose, /^\s+ports:\n\s+- ['"]?3001:/m)
  assert.match(nginx, /set_real_ip_from 172\.16\.0\.0\/12;/)
  assert.match(nginx, /real_ip_header X-Forwarded-For;/)
  assert.match(nginx, /real_ip_recursive on;/)
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/)
  assert.match(readme, /DEFAULT_API_URL: \$\{DEFAULT_API_URL:-https:\/\/api\.llm-token\.cn\/v1\}/)
  assert.match(readme, /LOCK_API_PROXY: 'true'/)
  assert.match(readme, /sudo chown 10001:10001 \/etc\/gpt-image-playground\/image-job-encryption-key/)
  assert.match(readme, /sudo chmod 400 \/etc\/gpt-image-playground\/image-job-encryption-key/)
  assert.match(settingsModal, /onClick=\{\(\) => updateActiveProfile\(\{ baseUrl: site\.url \}, true\)\}/)
  assert.doesNotMatch(settingsModal, /onClick=\{\(\) => updateActiveProfile\(\{ baseUrl: site\.url, apiProxy: false \}, true\)\}/)
  assert.match(settingsModal, /disabled=\{apiProxyEnabled\}[\s\S]{0,500}aria-pressed=\{selected\}/)
})

test('Service Worker 不缓存任务与代理接口并强制检查新版本', () => {
  const serviceWorker = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8')
  const main = readFileSync(path.join(process.cwd(), 'src/main.tsx'), 'utf8')
  const nginx = readFileSync(path.join(process.cwd(), 'deploy/nginx.conf'), 'utf8')
  const networkOnly = serviceWorker.indexOf("NETWORK_ONLY_PATH_PREFIXES = ['/api-proxy/', '/task-api/']")
  const cacheFirst = serviceWorker.indexOf('caches.match(request)')
  assert.notEqual(networkOnly, -1)
  assert.ok(cacheFirst > networkOnly)
  assert.match(serviceWorker, /NETWORK_ONLY_PATH_PREFIXES\.some[\s\S]{0,200}event\.respondWith\(fetch\(request\)\)/)
  assert.match(main, /serviceWorker\.register\([^\n]+\{ updateViaCache: 'none' \}\)/)
  assert.match(nginx, /location = \/sw\.js \{[\s\S]{0,200}Cache-Control "no-store, no-cache, must-revalidate"/)
})

test('Docker workflow 隔离只读 PR 校验与 GHCR 发布权限', () => {
  const workflow = readFileSync(path.join(process.cwd(), '.github/workflows/docker.yml'), 'utf8')
  assert.match(workflow, /pull_request:\n\s+branches: \['main'\]/)
  assert.match(workflow, /validate:\n\s+runs-on: ubuntu-latest\n\s+permissions:\n\s+contents: read/)
  assert.match(workflow, /publish:\n\s+if: github\.event_name != 'pull_request'\n\s+needs: validate/)
  assert.equal((workflow.match(/packages: write/g) ?? []).length, 1)
  assert.doesNotMatch(workflow, /docker\/setup-qemu-action@v3/)
  assert.equal((workflow.match(/if: github\.event_name == 'pull_request'/g) ?? []).length, 3)
  assert.equal((workflow.match(/platforms: linux\/amd64$/gm) ?? []).length, 4)
  assert.equal((workflow.match(/push: false/g) ?? []).length, 2)
  assert.doesNotMatch(workflow, /linux\/arm64/)
  assert.equal((workflow.match(/push: true/g) ?? []).length, 2)
  const validate = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('  publish:'))
  assert.doesNotMatch(validate, /packages: write|docker\/login-action|docker\/setup-qemu-action/)
  assert.equal((workflow.match(/value=latest,enable=\$\{\{ github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/g) ?? []).length, 2)
})

test('加密密钥优先从 secret 文件读取且环境变量无需保存密钥', async (t) => {
  const secretDir = mkdtempSync(path.join(os.tmpdir(), 'image-jobs-secret-test-'))
  const keyFile = path.join(secretDir, 'encryption-key')
  writeFileSync(keyFile, `${Buffer.alloc(32, 9).toString('hex')}\n`, { mode: 0o600 })
  t.after(() => rmSync(secretDir, { force: true, recursive: true }))

  const fixture = await createFixture(async (req, res) => {
    await readRequest(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  }, {
    IMAGE_JOB_ENCRYPTION_KEY: 'invalid-environment-value',
    IMAGE_JOB_ENCRYPTION_KEY_FILE: keyFile,
  })
  const id = randomUUID()
  const token = randomUUID()
  const response = await putJob(fixture, { id, token })
  assert.equal(response.status, 202)
  assert.equal((await waitForTerminal(fixture, id, token)).status, 'succeeded')
})

test('只有可信 Docker 代理来源可以提供真实用户 IP 链', async () => {
  const handler = async (req, res) => {
    await readRequest(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  }
  const trusted = await createFixture(handler, {
    IMAGE_JOB_TRUST_PROXY_CIDRS: '127.0.0.0/8,10.0.0.0/8',
  })
  const trustedJob = { id: randomUUID(), token: randomUUID() }
  const trustedResponse = await fetch(`${trusted.baseUrl}/v1/jobs/${trustedJob.id}?path=images%2Fgenerations`, {
    method: 'PUT',
    headers: {
      ...requestHeaders(trustedJob.token),
      'x-forwarded-for': '198.51.100.24, 10.4.0.8',
    },
    body: '{"prompt":"trusted-chain"}',
  })
  assert.equal(trustedResponse.status, 202)

  const expectedTrustedDigest = createHmac('sha256', Buffer.alloc(32, 7))
    .update('ip-address')
    .update('\0')
    .update('198.51.100.24')
    .digest('hex')
  const trustedDb = new DatabaseSync(path.join(trusted.dataDir, 'jobs.sqlite'))
  assert.equal(trustedDb.prepare('SELECT ip_digest FROM jobs WHERE id = ?').get(trustedJob.id).ip_digest, expectedTrustedDigest)
  trustedDb.close()

  const untrusted = await createFixture(handler, {
    IMAGE_JOB_TRUST_PROXY_CIDRS: '10.0.0.0/8',
  })
  const untrustedJob = { id: randomUUID(), token: randomUUID() }
  const untrustedResponse = await fetch(`${untrusted.baseUrl}/v1/jobs/${untrustedJob.id}?path=images%2Fgenerations`, {
    method: 'PUT',
    headers: {
      ...requestHeaders(untrustedJob.token),
      'x-forwarded-for': '203.0.113.99',
    },
    body: '{"prompt":"spoofed-chain"}',
  })
  assert.equal(untrustedResponse.status, 202)

  const expectedPeerDigest = createHmac('sha256', Buffer.alloc(32, 7))
    .update('ip-address')
    .update('\0')
    .update('127.0.0.1')
    .digest('hex')
  const untrustedDb = new DatabaseSync(path.join(untrusted.dataDir, 'jobs.sqlite'))
  assert.equal(untrustedDb.prepare('SELECT ip_digest FROM jobs WHERE id = ?').get(untrustedJob.id).ip_digest, expectedPeerDigest)
  untrustedDb.close()
})

test('启动时 running 和 dispatch_reserved 都转 unknown 且不重提', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture(async (req, res) => {
    upstreamCalls += 1
    await readRequest(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  const jobs = [
    { id: randomUUID(), token: randomUUID(), status: 'running' },
    { id: randomUUID(), token: randomUUID(), status: 'dispatch_reserved' },
  ]
  for (const job of jobs) {
    assert.equal((await putJob(fixture, job)).status, 202)
    assert.equal((await waitForTerminal(fixture, job.id, job.token)).status, 'succeeded')
  }
  assert.equal(upstreamCalls, 2)

  await fixture.proxy.close()
  fixture.proxy = null
  const db = new DatabaseSync(path.join(fixture.dataDir, 'jobs.sqlite'))
  for (const job of jobs) {
    db.prepare(`
      UPDATE jobs
      SET status = ?, finished_at = NULL, upstream_status = NULL,
          result_file = NULL, result_meta_file = NULL, result_size = NULL,
          result_digest = NULL, error_code = NULL
      WHERE id = ?
    `).run(job.status, job.id)
  }
  db.close()

  const logs = []
  const restarted = createImageJobProxy({ env: fixture.env, logger: (entry) => logs.push(entry) })
  const address = await restarted.listen()
  fixture.proxy = restarted
  fixture.baseUrl = `http://127.0.0.1:${address.port}`
  for (const job of jobs) {
    const response = await getJob(fixture, job.id, job.token)
    assert.equal(response.status, 200)
    const state = await response.json()
    assert.equal(state.status, 'unknown')
    assert.equal(state.error, 'outcome_unknown_after_restart')
    assert.equal(state.hasResult, false)
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(upstreamCalls, 2)
  assert.deepEqual(logs.map((entry) => entry.status), ['unknown', 'unknown'])
})

test('只允许固定的三条上游路径', async () => {
  let upstreamCalls = 0
  const fixture = await createFixture((_req, res) => {
    upstreamCalls += 1
    res.end('{}')
  })
  const response = await putJob(fixture, {
    upstreamPath: 'https://metadata.internal/latest',
  })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'unsupported_upstream_path' })
  assert.equal(upstreamCalls, 0)
})

test('日志和持久文件不含 API key、提示词、参考图或响应明文', async () => {
  const apiKey = 'fake-sensitive-api-key-do-not-store'
  const prompt = 'private prompt phrase 9b2f54c7'
  const referenceImage = 'private-reference-image-data-83c6ef'
  const upstreamResult = 'private-upstream-result-d2a71f'
  let receivedAuthorization
  let receivedBody
  const fixture = await createFixture(async (req, res) => {
    receivedAuthorization = req.headers.authorization
    receivedBody = (await readRequest(req)).toString('utf8')
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-sensitive-test' })
    res.end(upstreamResult)
  })
  const id = randomUUID()
  const token = randomUUID()
  const body = JSON.stringify({ prompt, image: referenceImage })
  assert.equal((await putJob(fixture, {
    id,
    token,
    body,
    authorization: `Bearer ${apiKey}`,
  })).status, 202)
  assert.equal((await waitForTerminal(fixture, id, token)).status, 'succeeded')
  assert.equal(receivedAuthorization, `Bearer ${apiKey}`)
  assert.equal(receivedBody, body)

  const result = await fetch(`${fixture.baseUrl}/v1/jobs/${id}/result`, {
    headers: { 'x-task-token': token },
  })
  assert.equal(await result.text(), upstreamResult)
  const db = new DatabaseSync(path.join(fixture.dataDir, 'jobs.sqlite'))
  const stored = db.prepare('SELECT request_file, headers_file FROM jobs WHERE id = ?').get(id)
  assert.equal(stored.request_file, null)
  assert.equal(stored.headers_file, null)
  db.close()

  const forbidden = [apiKey, prompt, referenceImage, upstreamResult]
  const logText = JSON.stringify(fixture.logs)
  const diskText = readdirSync(fixture.dataDir)
    .map((name) => readFileSync(path.join(fixture.dataDir, name)).toString('utf8'))
    .join('\n')
  for (const value of forbidden) {
    assert.equal(logText.includes(value), false)
    assert.equal(diskText.includes(value), false)
  }
  assert.deepEqual(Object.keys(fixture.logs.at(-1)).sort(), [
    'attempt',
    'durationMs',
    'httpStatus',
    'jobId',
    'maxAttempts',
    'retryDelayMs',
    'retryReason',
    'status',
    'upstreamRequestId',
  ])
})
