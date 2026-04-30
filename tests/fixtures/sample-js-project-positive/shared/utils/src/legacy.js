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

// Common browser globals - the no-undef rule must recognise these as
// runtime-defined and not flag them as ReferenceErrors.
const buildRequest = (url, body) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  return new Request(url, { method: 'POST', headers, body });
};

const fireReady = (detail) => {
  const event = new CustomEvent('ready', { detail });
  document.dispatchEvent(event);
};

const newAbortController = () => new AbortController();

// Internal-state writes via a key derived from in-app values (not user
// input). The prototype-pollution detector should not fire on
// `state[key] = ...` when `key` is the return value of a local helper that
// composes app-controlled identifiers - there's no path for `__proto__`
// or `constructor` to reach `key` short of a separate code-path bug.
const state = {};
const computeBucketKey = (dataset, source) => `${dataset}:${source}`;

const recordSample = (dataset, source, value) => {
  const key = computeBucketKey(dataset, source);
  state[key] = value;
};

module.exports = {
  config, data, safeParse, safeRun, buildRequest, fireReady, newAbortController,
  state, recordSample,
};

// Helper functions declared inside an IIFE and used by sibling functions
// in the same IIFE body. The no-undef rule must hoist `function`
// declarations into their enclosing function scope so callers can resolve
// them; without this the declaration looks invisible to the scope chain.
(() => {
  const els = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    els.panel = byId('tab-unbatched');
    els.meta = byId('ub-meta');
  }

  cacheElements();
})();
