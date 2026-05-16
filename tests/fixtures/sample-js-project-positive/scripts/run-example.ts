
// process.exit(1) passes number to exit() which expects a number — no type mismatch
declare const process: { exit: (code: number) => never };
declare function fetchData(): Promise<void>;

async function main() {
  await fetchData();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});



// promise .catch() error handler (main().catch(...))
async function runMainScript(): Promise<void> {
  console.log('Starting script...');
  // script logic here
  console.log('Done.');
}

runMainScript().catch((error) => {
  console.error(error);
  process.exit(1);
});
