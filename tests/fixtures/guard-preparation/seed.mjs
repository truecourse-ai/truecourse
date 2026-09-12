import fs from 'node:fs'
const token = process.env.GUARD_PREPARATION_NAMESPACE
const rows = process.env.GUARD_PREPARATION_BASELINE==='empty'?[]:Array.from({length:8},(_,i)=>({id:i+1,amount:i+1,tenant:i%2?'b':'a',status:i%2?'pending':'completed',date:'2099-01-01'}))
fs.writeFileSync(process.env.DATA_FILE,JSON.stringify({token,rows}))
fs.writeFileSync(process.env.GUARD_SEED_OUT,JSON.stringify({credentials:{owner:{value:token}},fixtures:{inputs:{count:rows.length,total:rows.reduce((n,r)=>n+r.amount,0),rows}}}))
