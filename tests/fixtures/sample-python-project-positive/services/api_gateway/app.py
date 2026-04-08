"""HTTP server entry point for the API gateway."""

from http.server import BaseHTTPRequestHandler, HTTPServer
from json import dumps
from logging import getLogger, INFO

HOST = "127.0.0.1"
DEFAULT_PORT = 8080
HEALTH_PATH = "/health"
USERS_PATH = "/users"
HTTP_OK = 200
HTTP_NOT_FOUND = 404

_logger = getLogger(__name__)


def _handle_get(path: str) -> tuple:
    """Route a GET request to a simple handler."""
    if path == HEALTH_PATH:
        return HTTP_OK, dumps({"status": "ok"})
    return HTTP_NOT_FOUND, dumps({"error": "not found", "path": path})


def _handle_post(path: str, raw_body: str) -> tuple:
    """Route a POST request to a simple handler."""
    if path == USERS_PATH:
        return HTTP_OK, dumps({"received": True})
    return HTTP_NOT_FOUND, dumps({"error": "not found", "path": path})


class GatewayHandler(BaseHTTPRequestHandler):
    """Request handler for the API gateway."""

    def do_GET(self) -> None:
        """Handle GET requests by dispatching to the route handler."""
        status_code, body = _handle_get(self.path)
        self._send_response(status_code, body)

    def do_POST(self) -> None:
        """Handle POST requests by reading the body and dispatching."""
        raw_length = self.headers.get("Content-Length")
        content_length = int(raw_length) if raw_length is not None else 0
        raw_body = self.rfile.read(content_length).decode()
        status_code, body = _handle_post(self.path, raw_body)
        self._send_response(status_code, body)

    def _send_response(self, status_code: int, body: str) -> None:
        """Write an HTTP response with the given status and body.

        Args:
            status_code: The HTTP status code.
            body: The response body string.
        """
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt: str, *args: object) -> None:
        """Override default logging to use our logger.

        Args:
            fmt: The format string for the log message.
            args: Format arguments.
        """
        _logger.info("[%s] %s", self.client_address[0], fmt % args)


def start_server(port: int = DEFAULT_PORT) -> None:
    """Start the HTTP server on the configured host and port.

    Args:
        port: The TCP port to listen on.
    """
    server = HTTPServer((HOST, port), GatewayHandler)
    _logger.info("Gateway listening on %s:%d", HOST, port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _logger.info("Shutting down gateway server")
    finally:
        server.server_close()


def configure_logging(level: int = INFO) -> None:
    """Configure the gateway logger level.

    Args:
        level: The desired logging level.
    """
    _logger.setLevel(level)
    for handler in _logger.handlers:
        handler.setLevel(level)
