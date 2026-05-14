
// parseInt with environment variable and fallback
function getServerPort(): number {
  return parseInt(process.env.PORT || '3000', 10);
}

function getWorkerTimeout(): number {
  return parseInt(process.env.WORKER_TIMEOUT_MS || '30000', 10);
}
