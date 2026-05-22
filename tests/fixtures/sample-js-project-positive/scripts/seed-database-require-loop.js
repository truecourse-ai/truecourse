// Paraphrased FP shape for performance/deterministic/sync-require-in-handler.
//
// CLI seed scripts run once and exit — they have no request-handler latency
// to protect. Dynamic `require(path)` inside an async top-level driver is
// the idiomatic way to iterate over a directory of seed modules.

const files = ['users.js', 'documents.js'];

const runAll = async () => {
  for (const file of files) {
    const mod = require(`${__dirname}/seed/${file}`);
    if (mod && typeof mod.run === 'function') {
      await mod.run();
    }
  }
};

runAll().catch((err) => {
  console.error(err);
});
