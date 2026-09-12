import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { app } = await import(pathToFileURL(path.join(process.env.GUARD_REPO_ROOT, 'server.mjs')));
const env = process.env, peer = JSON.parse(env.GUARD_PREPARATION_PEER_ENV);
assert.equal(env.APP_ORIGIN, 'http://127.0.0.1:${PORT}');
assert.equal(peer.APP_ORIGIN, env.APP_ORIGIN);
const a = app(env), b = app(env.TEST_FALSE_ISOLATION === 'yes' ? env : peer);
const start = instance => new Promise(resolve => instance.server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${instance.server.address().port}`)));
try {
  const [urlA, urlB] = await Promise.all([start(a), start(b)]);
  const headers = { 'x-world-token': JSON.parse(env.GUARD_PREPARATION_CREDENTIALS).owner.value };
  const peerHeaders = { 'x-world-token': JSON.parse(env.GUARD_PREPARATION_PEER_CREDENTIALS).owner.value };
  const read = async (url, headers) => {
    const response = await fetch(url + '/rpc/documents?input=%7B%7D', { headers });
    assert.equal(response.status, 200);
    return (await response.json()).result.data.json;
  };
  for (const [url, auth] of [[urlA, headers], [urlB, peerHeaders]]) {
    const response = await fetch(url + '/session', { headers: auth });
    assert.equal(response.status, 200);
  }
  const before = await read(urlA, headers), other = await read(urlB, peerHeaders);
  const count = env.GUARD_PREPARATION_BASELINE === 'empty' ? 0 : 2;
  assert.equal(before.count, count); assert.equal(other.count, count);
  if (count) assert.deepEqual(before.rows.map(row => row.status), ['pending', 'completed']);
  const added = await fetch(urlB + '/rpc/documents?input=%7B%7D', { method: 'POST', headers: peerHeaders });
  assert.equal(added.status, 200);
  assert.equal((await read(urlB, peerHeaders)).count, count + 1);
  assert.deepEqual(await read(urlA, headers), before);
  fs.writeFileSync(env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { verification: { baseline: env.GUARD_PREPARATION_BASELINE, isolated: true } } }));
} finally { await Promise.all([a.close(), b.close()]); }
