export type CodeViolation = {
  ruleKey: string
  filePath: string
  lineStart: number
  lineEnd: number
  columnStart: number
  columnEnd: number
  severity: string
  title: string
  content: string
  snippet: string
  fixPrompt?: string
}
