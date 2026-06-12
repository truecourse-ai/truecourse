// FP-GUARD: operation/implementation-missing — must NOT drift
// Paraphrase of plugin route files that export route descriptors as a
// typed object (type + routes array) with paths relative to the plugin
// mount prefix. The extractor must resolve prefix + relative path to the
// full URL so it matches the spec identity.

export default {
  type: 'admin',
  routes: [
    {
      method: 'POST',
      path: '/',
      handler: 'entries.create',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/:id',
      handler: 'entries.findOne',
      config: { policies: [] },
    },
  ],
};

// The DELETE route is intentionally absent — regression guard.
// IL-DRIFT: Operation:DELETE /catalog/{id} / implementation.missing
