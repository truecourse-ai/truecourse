// Regression: PipelineStage genuinely has no code counterpart — its values
// do not appear as any named enum or type alias anywhere in the codebase.
// no-code-counterpart must still fire after the value-set match fix.
// IL-DRIFT: Enum:PipelineStage / enum.PipelineStage.no-code-counterpart
