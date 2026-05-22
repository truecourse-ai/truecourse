// `!!process.env.X` and `!process.env.X` coerce undefined to a boolean,
// which IS validation — the resulting value is well-defined whether the
// env var is set or not.

export const HAS_LICENSE_KEY = !!process.env.SAMPLE_LICENSE_KEY;
export const IS_DEBUG_DISABLED = !process.env.SAMPLE_DEBUG;
