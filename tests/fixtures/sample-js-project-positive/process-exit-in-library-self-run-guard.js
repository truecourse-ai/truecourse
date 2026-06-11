// A standalone CLI script. The `require.main === module` guard marks this file
// as a runnable entry point, so terminating the process with an exit code is
// appropriate here — this is not a reusable library module, even though its
// filename does not match the usual entry-point naming conventions, and the
// exit call inside the helper is reached only when the script is run directly.

const runChecks = (args) => {
  if (args.length === 0) {
    process.exit(1);
  }
  return args.length;
};

if (require.main === module) {
  const argCount = runChecks(process.argv.slice(2));
  process.exit(argCount > 0 ? 0 : 1);
}
