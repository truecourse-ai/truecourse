import http from 'node:http';

async function convert() {
  const key = process.env.CURRENCYBEACON_API_KEY?.trim();
  if (!key) return { status: 503, body: { error: 'Missing CurrencyBeacon key' } };
  const base = process.env.CURRENCYBEACON_BASE_URL ?? 'https://api.currencybeacon.com';
  const url = new URL('/v1/latest', base);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok) return { status: 502, body: { error: 'Provider rejected request' } };
  const result = await response.json();
  return { status: 200, body: { amountCents: 2500, convertedAmountCents: Math.round(2500 * result.rate) } };
}
http.createServer(async (request, response) => {
  const result = request.url === '/convert' ? await convert() : {status: 200, body: {ok: true}};
  response.writeHead(result.status, {'Content-Type': 'application/json'});
  response.end(JSON.stringify(result.body));
}).listen(Number(process.env.PORT), '127.0.0.1');
