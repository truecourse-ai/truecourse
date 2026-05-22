// True bug: two back-to-back assignments to the same property, with
// nothing observing the first one (no await, no read). The first assignment
// is dead code.

type Config = { retries: number };

export function applyConfig(config: Config): Config {
  // VIOLATION: bugs/deterministic/element-overwrite
  config.retries = 1;
  config.retries = 3;
  return config;
}
