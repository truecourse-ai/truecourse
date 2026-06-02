/**
 * Positive fixture for bugs/deterministic/unbound-method.
 *
 * Private-name fields (`#name`) parse as `private_property_identifier`
 * — not `property_identifier`. The class-body walk used to skip those
 * declarations entirely, so `this.#flag` / `this.#logger` references
 * passed as call arguments or constructor properties were classified
 * as unbound method references even though they're plain data fields
 * (boolean flag, logger instance) that never had a `this` binding to
 * lose.
 */

interface Logger {
  info(msg: string): void;
}

class WireBuilder {
  private readonly transport: { send(payload: { logger: Logger }): void };
  constructor(transport: { send(payload: { logger: Logger }): void }) {
    this.transport = transport;
  }
  send(payload: { logger: Logger }): void {
    this.transport.send(payload);
  }
}

export class Driver {
  readonly #logger: Logger;
  #ready: boolean = false;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  bootstrap(): WireBuilder {
    const builder = new WireBuilder({
      send: (payload) => this.#logger.info(payload.logger.info.name),
    });
    builder.send({ logger: this.#logger });
    return builder;
  }

  status(): boolean {
    return this.#emitReady(this.#ready);
  }

  #emitReady(flag: boolean): boolean {
    this.#logger.info(`ready=${flag}`);
    return flag;
  }
}
