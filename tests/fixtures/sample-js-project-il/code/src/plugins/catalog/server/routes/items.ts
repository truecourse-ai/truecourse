// FP-GUARD: operation/response-200 — must NOT drift
// Paraphrase of plugin-style route descriptors where each route references a
// named handler string rather than an inline function body.
// extractPluginStyleRoutesFromFile builds OperationContract with responses:[]
// because no handler body is walked (cross-handler tracing is out of v1 scope).
// The comparator must treat an empty code-side response list as "unverifiable",
// not "response 200 was never emitted".

// Plugin lifecycle events (`installed`, `activated`, `deactivated`, `removed`)
// are dispatched by the plugin host rather than declared here; the spec-side
// `PluginEventType` enum has no code counterpart inside this plugin module.
// IL-DRIFT: Enum:PluginEventType / enum.PluginEventType.no-code-counterpart

export default [
  {
    method: 'GET',
    path: '/items',
    handler: 'items.findAll',
    config: { policies: ['auth::isAuthenticated'] },
  },
  {
    method: 'POST',
    path: '/items',
    handler: 'items.create',
    config: { policies: ['auth::isAuthenticated'] },
  },
];
