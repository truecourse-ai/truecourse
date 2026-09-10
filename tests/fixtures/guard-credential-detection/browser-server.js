import http from 'node:http'
const html = `<!doctype html><html><body><label>Amount<input id="amount" value="25"></label><button id="convert">Convert</button><button id="save">Save expense</button><p role="status" id="notice"></p><p id="result"></p><script>
const result = document.getElementById('result');
document.getElementById('amount').oninput = () => { result.textContent = ''; };
document.getElementById('save').onclick = () => { document.getElementById('notice').textContent = 'Expense saved.'; };
document.getElementById('convert').onclick = async () => {
  const response = await fetch('/convert'); const body = await response.json();
  result.textContent = response.ok ? 'Converted: ' + body.convertedAmountCents : body.error;
};
</script></body></html>`
http
  .createServer(async (req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
      return
    }
    let status = 200,
      body = { ok: true }
    if (req.url === '/convert') {
      if (!process.env.CURRENCYBEACON_API_KEY) {
        status = 503
        body = { error: 'Missing CurrencyBeacon key' }
      } else {
        const response = await fetch(new URL('/v1/latest', process.env.CURRENCYBEACON_BASE_URL), {
          headers: { Authorization: 'Bearer ' + process.env.CURRENCYBEACON_API_KEY },
        })
        if (!response.ok) {
          status = 502
          body = { error: 'Provider rejected request' }
        } else {
          const value = await response.json()
          body = { convertedAmountCents: Math.round(2500 * value.rate) }
        }
      }
    }
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  .listen(Number(process.env.PORT), '127.0.0.1')
