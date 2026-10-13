import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const bridge = fileURLToPath(new URL('../bin/bridge.mjs', import.meta.url))

function request(socketPath, route, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request({ socketPath, path: route, method: data === undefined ? 'GET' : 'POST', timeout: 2_000 }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }) } catch (error) { reject(error) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('HTTP timeout')))
    req.on('error', reject)
    req.end(data)
  })
}

const alive = pid => {
  try { process.kill(pid, 0); return true } catch { return false }
}

test('bridge routes messages, tracks turns, and shuts down its Codex child', { timeout: 10_000 }, async t => {
  // A short path also works within macOS's Unix socket path length limit.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cxb-test-'))
  const fake = path.join(dir, 'fake-codex')
  await fs.writeFile(fake, `#!/usr/bin/env node
const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === 'turn/start') {
    send({ id: msg.id, result: { turn: { id: 'turn-test' } } });
    send({ method: 'turn/started', params: { threadId: msg.params.threadId, turn: { id: 'turn-test' } } });
  } else if (msg.method === 'turn/interrupt') {
    send({ id: msg.id, result: {} });
    send({ method: 'turn/completed', params: { threadId: msg.params.threadId, turn: { id: 'turn-test', status: 'interrupted', items: [] } } });
  } else send({ id: msg.id, result: {} });
});
`, { mode: 0o700 })
  const child = spawn(process.execPath, [bridge, '--daemon', fake, dir], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const exited = once(child, 'exit')
  let codexPid
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    if (codexPid && alive(codexPid)) process.kill(codexPid, 'SIGTERM')
    await fs.rm(dir, { recursive: true, force: true })
  })
  const socket = path.join(dir, 's')
  let health
  for (let i = 0; i < 100; i++) {
    try { health = await request(socket, '/health'); break } catch { await delay(20) }
  }
  assert.equal(health?.body.ok, true, stderr)
  codexPid = health.body.codexPid
  assert.equal(alive(codexPid), true)

  await request(socket, '/rpc', { method: 'turn/start', params: { threadId: 'thread-test' } })
  const running = await request(socket, '/health')
  assert.equal(running.body.active['thread-test'], 'turn-test')
  const waiting = request(socket, '/wait', { threadId: 'thread-test', msgKey: 'mail-test', timeoutMs: 1_000 })
  await request(socket, '/msg', { key: 'mail-test', text: 'question for Claude' })
  assert.deepEqual((await waiting).body, { status: 'message', messages: ['question for Claude'] })

  await request(socket, '/rpc', { method: 'turn/interrupt', params: { threadId: 'thread-test', turnId: 'turn-test' } })
  assert.equal((await request(socket, '/wait', { threadId: 'thread-test', timeoutMs: 1 })).body.turn.status, 'interrupted')
  assert.deepEqual((await request(socket, '/shutdown', {})).body, { ok: true })
  assert.equal((await exited)[0], 0)
  for (let i = 0; i < 100 && alive(codexPid); i++) await delay(10)
  assert.equal(alive(codexPid), false)
  await assert.rejects(fs.stat(socket), { code: 'ENOENT' })
})
