#!/usr/bin/env node
// Fixture "server" that dies at startup — exercises the api boot-failure paths.
console.error('fatal: cannot bind — fixture crash')
process.exit(1)
