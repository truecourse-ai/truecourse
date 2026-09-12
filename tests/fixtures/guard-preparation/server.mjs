import http from 'node:http'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
export function app(env) {
  const file = env.DATA_FILE
  return http.createServer(async (req, res) => {
    if (req.url === '/health') return res.end('healthy')
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/redirect') { res.writeHead(302, { location: '/rows' }); return res.end() }
    let state = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (req.headers['x-world-token'] !== state.token) { res.statusCode = 401; return res.end('unauthorized') }
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk
      const rows = JSON.parse(raw)
      state.rows.push(...rows)
      fs.writeFileSync(file, JSON.stringify(state))
    }
    if (url.pathname === '/rpc/rows') {
      if (!url.searchParams.has('input')) { res.statusCode = 400; return res.end('input required') }
      const input = JSON.parse(url.searchParams.get('input'))
      if (input.tenant) state.rows = state.rows.filter(row => row.tenant === input.tenant)
      if (input.status) state.rows = state.rows.filter(row => row.status === input.status)
    }
    const ordered = [...state.rows].sort((a,b) => b.date.localeCompare(a.date) || b.id-a.id)
    if(env.BROKEN_ORDER==='yes')ordered.reverse()
    const query=new URL(req.url,'http://localhost').searchParams
    const limit=Number(query.get('limit')||ordered.length||1),page=Number(query.get('page')||1)
    const offset=(page-1)*limit+(env.BROKEN_PAGE==='yes'?1:0)
    const rows=query.has('page')?ordered.slice(offset,offset+limit):ordered
    const total = ordered.reduce((n,r)=>n+r.amount,0)+(env.BROKEN_TOTAL==='yes'?1:0)
    if (req.url === '/') {
      res.setHeader('content-type','text/html')
      return res.end(`<h1>Ledger</h1><p>Total: ${total}</p><p>Count: ${rows.length}</p><table aria-label="Rows">${rows.map(r=>`<tr><td>${r.id}</td><td>${r.amount}</td></tr>`).join('')}</table>`)
    }
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify({count:ordered.length,total,rows}))
  })
}
if (import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) app(process.env).listen(Number(process.env.PORT || 0),'127.0.0.1')
