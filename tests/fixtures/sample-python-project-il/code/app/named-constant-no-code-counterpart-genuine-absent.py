"""Storage writer configuration.

The spec pins storage.writer.batch_depth_limit = 500 as a named constant,
but the code has no corresponding declaration — the limit is hard-wired
inline and never named.

# IL-DRIFT: NamedConstant:storage.writer.batch_depth_limit / constant.storage.writer.batch_depth_limit.no-code-counterpart
"""
