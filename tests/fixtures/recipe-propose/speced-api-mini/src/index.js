// A weather-service-shaped api, minus the weather: the routes exist so the health
// path can be RANKED over a real surface (/healthz wins over /forecast).
import http from 'node:http'

const routes = {
  // `/` answers too: with no route surface handed in, the ranking proposes no
  // health path and the runner polls `/` — a fixture that 404s there could never
  // be verified by a caller that skips journey mapping.
  'GET /': () => ({ service: 'speced-api-mini' }),
  'GET /healthz': () => ({ status: 'ok' }),
  'GET /forecast': () => ({ forecast: 'sunny' }),
}

http
  .createServer((req, res) => {
    const handler = routes[`${req.method} ${new URL(req.url, 'http://localhost').pathname}`]
    res.writeHead(handler ? 200 : 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify(handler ? handler() : { error: 'not found' }))
  })
  .listen(Number(process.env.PORT) || 3000, '127.0.0.1')
