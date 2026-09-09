import fs from 'node:fs'
import path from 'node:path'
if(!process.env.GUARD_PREPARATION_NAMESPACE||!process.env.GUARD_PREPARATION_DIRECTORY)throw new Error('no owned allocation')
if(process.env.CLEANUP_LOG)fs.appendFileSync(process.env.CLEANUP_LOG,JSON.stringify({directory:process.env.GUARD_PREPARATION_DIRECTORY,namespace:process.env.GUARD_PREPARATION_NAMESPACE})+'\n')
const target=path.resolve(process.env.DATA_FILE),root=path.resolve(process.env.GUARD_PREPARATION_DIRECTORY)
if(!target.startsWith(root+path.sep))throw new Error('cleanup target outside owned directory')
fs.rmSync(target,{force:true})
