'use strict';
const config = {};
const data = { initialized: true };

// Short catch handlers - log-only or return-default - don't need to
// discriminate the error type. JS doesn't support typed catch parameters
// (TS does, via `: unknown`), so the catch-without-error-type rule's
// suggestion to "add a type annotation" doesn't apply in plain JS. Skip
// short single-statement handlers that simply log or return a default.
const safeParse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
};

const safeRun = (work) => {
  try {
    work();
  } catch (err) {
    console.error('safeRun failed', err);
  }
};

module.exports = { config, data, safeParse, safeRun };
