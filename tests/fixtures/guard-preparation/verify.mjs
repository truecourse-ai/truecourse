import fs from 'node:fs'
import assert from 'node:assert/strict'
import { app } from './server.mjs'
const env=process.env, peer=JSON.parse(env.GUARD_PREPARATION_PEER_ENV)
const a=app(env),b=app(peer)
const start=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)))
try {
  const [urlA,urlB]=await Promise.all([start(a),start(b)])
  const creds=JSON.parse(env.GUARD_PREPARATION_CREDENTIALS),peerCreds=JSON.parse(env.GUARD_PREPARATION_PEER_CREDENTIALS)
  const headers={'x-world-token':creds.owner.value},peerHeaders={'x-world-token':peerCreds.owner.value}
  const before=await (await fetch(urlA+'/rows',{headers})).json()
  const other=await (await fetch(urlB+'/rows',{headers:peerHeaders})).json()
  const count=env.GUARD_PREPARATION_BASELINE==='empty'?0:8
  assert.equal(before.count,count);assert.equal(other.count,count)
  assert.equal(before.total,count?36:0);assert.equal(other.total,count?36:0)
  await fetch(urlB+'/rows',{method:'POST',headers:peerHeaders,body:JSON.stringify([{id:100,amount:100,date:'2100-01-01'}])})
  const after=await (await fetch(urlA+'/rows',{headers})).json()
  assert.deepEqual(after,before)
  fs.writeFileSync(env.GUARD_SEED_OUT,JSON.stringify({fixtures:{verification:{baseline:env.GUARD_PREPARATION_BASELINE,isolated:true}}}))
} finally { await Promise.all([new Promise(r=>a.close(r)),new Promise(r=>b.close(r))]) }
