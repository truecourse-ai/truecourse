interface Logger {
  debug(msg: string, fields: Record<string, unknown>): void;
}

interface StreamSender {
  send(payload: { event?: string; data: string }): void;
}

declare const logger: Logger;

const ABORT_REASON = "abort-due-to-send-failure";

interface Controller {
  abort(reason: string): void;
}

export function streamWithLogging(
  sender: StreamSender,
  controller: Controller,
  event: string | undefined,
  data: string,
): void {
  try {
    sender.send({ event, data });
  } catch (error) {
    if (error instanceof Error && error.name !== "TypeError") {
      logger.debug("Error sending stream chunk", {
        channel: "stream-presenter",
        stage: "send",
        eventName: event,
        attemptedBytes: data.length,
        guidance: "verify downstream throughput before retrying",
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      });
    }
    controller.abort(ABORT_REASON);
  }
}
