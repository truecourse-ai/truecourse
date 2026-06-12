// FP-GUARD: named-constant/no-code-counterpart — must NOT drift
// Paraphrase of browser window globals that a host page can configure.
// The spec names them under a "widget." namespace prefix; in code they
// appear as window.X accesses (no namespace). The extractor must emit
// these as named constants so the comparator can find them via the
// last-segment fallback for namespaced spec identities.
const darkMode  = window.EMBED_DARK_MODE ?? false;
const locale    = window.EMBED_LOCALE    ?? 'en';

// widget.EMBED_THEME is intentionally absent from code — regression:
// the no-code-counterpart drift must still fire.
// IL-DRIFT: NamedConstant:widget.EMBED_THEME / constant.widget.EMBED_THEME.no-code-counterpart
export { darkMode, locale };
