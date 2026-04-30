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

// Client-side state managed via a JS `Set`. `state.expandedVendors.add(...)`
// is a Set membership update, not a database write - even though the
// vendor name comes from a `data-vendor` HTML attribute (external input
// in a request-handler sense). The unvalidated-external-data detector
// must not flag `Set.add()` style calls just because `add` is in the
// ambiguous-ORM-method list.
const expandedVendors = new Set();
const onClick = (event) => {
  const vendor = String(event.target.getAttribute('data-vendor') || '');
  if (!vendor) return;
  if (expandedVendors.has(vendor)) {
    expandedVendors.delete(vendor);
  } else {
    expandedVendors.add(vendor);
  }
};
module.exports.onClick = onClick;

// Destructured arrow parameters and for...of variables - the no-undef
// rule's scope tracker must recognise both as in-scope declarations,
// otherwise it fires ReferenceError-style FPs on perfectly normal JS.
const summarize = (entries) => {
  let total = 0;
  entries.forEach(([key, value]) => {
    total += String(key).length + Number(value);
  });
  const separators = [',', ';', '|'];
  let lastSep = '';
  for (const sep of separators) {
    lastSep = sep;
  }
  return { total, lastSep };
};
module.exports.summarize = summarize;

// Pre-escaped innerHTML assignments. The disabled-auto-escaping detector
// must recognise calls to local helpers like `esc()` / `escapeHtml()` /
// `sanitize()` / `DOMPurify.sanitize()` as escaping, otherwise it fires
// on every dynamic-but-escaped fragment - the same as if the writer had
// not escaped at all.
const esc = (s) => String(s).replace(/[&<>"']/gu, (c) => `&#${c.charCodeAt(0)};`);

const renderUserName = (host, raw) => {
  host.innerHTML = `<span class="name">${esc(raw)}</span>`;
};

const renderRowEscaped = (host, label) => {
  host.innerHTML = `<tr><td>${esc(label)}</td></tr>`;
};

module.exports.renderUserName = renderUserName;
module.exports.renderRowEscaped = renderRowEscaped;

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
