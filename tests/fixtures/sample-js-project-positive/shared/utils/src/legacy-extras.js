'use strict';

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

// Destructured key from a forEach iteration writes to a local map. The
// prototype-pollution detector should treat destructured arrow / function
// parameters the same as keys assigned from local helper calls - they're
// scoped to the iteration, not user-controlled at this site.
const indexEntries = (entries) => {
  const out = {};
  entries.forEach(([key, val]) => {
    out[key] = val;
  });
  return out;
};
module.exports.indexEntries = indexEntries;

// Single-param arrow without parentheses: `t => ...`. Tree-sitter JS
// represents the parameter as a bare `identifier` child of `arrow_function`
// (no `formal_parameters` wrapper). The scope tracker has to register
// that identifier as a parameter binding, otherwise both the param
// declaration and every use inside the body look undeclared to no-undef.
const doubleAll = (xs) => xs.map(t => t * 2);
const labelAll = (xs) => xs.map(t => ({ value: t, label: t }));
const toggle = (prev) => (prev ? null : 'open');
const flipFlag = () => toggle('a');
module.exports.doubleAll = doubleAll;
module.exports.labelAll = labelAll;
module.exports.flipFlag = flipFlag;

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
