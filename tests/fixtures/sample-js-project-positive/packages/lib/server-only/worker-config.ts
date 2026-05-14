
// Math.min(workers, 6) caps parallel workers at 6 — reasonable machine concurrency limit
declare const os: { cpus(): Array<unknown> };

function calculateWorkerCount(): number {
  const total = os.cpus().length;
  const usable = Math.max(total - 2, 1);
  const workers = Math.max(Math.floor(usable / 2), 1);
  return Math.min(workers, 6);
}
