/**
 * Reliability violations: missing process error handlers in entry-point file.
 * File named "server.ts" to trigger entry-point detection.
 */

// VIOLATION: reliability/deterministic/uncaught-exception-no-handler
// VIOLATION: reliability/deterministic/unhandled-rejection-no-handler
// No process error handlers are registered for unhandled errors or promise rejections.

import http from 'http';

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
