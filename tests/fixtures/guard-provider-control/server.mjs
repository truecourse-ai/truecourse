import http from 'node:http'
http.createServer(async (req, res) => {
  if (req.url === '/health') return res.end('healthy')
  if (req.url === '/') {
    res.setHeader('content-type', 'text/html')
    return res.end(`<button onclick="fetch('/convert').then(r=>r.json()).then(x=>document.querySelector('p').textContent=x.message)">Convert</button><p role="status"></p>`)
  }
  let status = 200, message
  for (let attempt = 0; attempt <= Number(process.env.RETRY || 0); attempt++) {
    try {
      const response = await fetch(new URL('/rate', process.env.PROVIDER_BASE), { signal: AbortSignal.timeout(120), headers: { authorization: 'Bearer ' + process.env.PROVIDER_KEY } })
      if (!response.ok) { status = 502; message = 'Provider status ' + response.status }
      else {
        const data = await response.json()
        if (typeof data.rate !== 'number') throw new Error('invalid rate')
        status = 200; message = 'Converted: ' + Math.round(2500 * data.rate)
      }
    } catch { status = 502; message = 'Provider unavailable' }
    if (status === 200) break
  }
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ message }))
}).listen(Number(process.env.PORT), '127.0.0.1')
