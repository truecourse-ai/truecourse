import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { registerChildProcess, unregisterChildProcess } from '../analysis-registry.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodType } from 'zod';
import type { Violation } from '@truecourse/shared';
import { config } from '../../config/index.js';
import {
  getPrompt,
  buildServiceTemplateVars,
  buildDatabaseTemplateVars,
  buildModuleTemplateVars,
  buildCodeTemplateVars,
  buildFlowTemplateVars,
  resolveId,
  resolveIds,
  type FlowEnrichmentContext,
  type PromptIdMap,
} from './prompts.js';
import {
  ServiceViolationOutputSchema,
  DatabaseViolationOutputSchema,
  ModuleViolationOutputSchema,
  DiffViolationOutputSchema,
  LifecycleServiceOutputSchema,
  CodeViolationOutputSchema,
  CodeViolationLifecycleOutputSchema,
  FlowEnrichmentOutputSchema,
} from './schemas.js';
import { recordUsageBatch, type UsageData } from '../usage.service.js';
import type {
  LLMProvider,
  UsageRecord,
  ServiceViolationContext,
  DatabaseViolationContext,
  ModuleViolationContext,
  AllViolationsInput,
  AllViolationsResult,
  AllViolationsLifecycleResult,
  CodeViolationContext,
  ServiceViolationsResult,
  DatabaseViolationsResult,
  ModuleViolationsResult,
  CodeViolationsResult,
  CodeViolationRaw,
  FlowEnrichmentResult,
  DiffViolationItem,
  DiffViolationsResult,
  ServiceDescription,
} from './provider.js';

// ---------------------------------------------------------------------------
// Logging helper — clears the current terminal line before printing so
// log messages don't collide with the clack spinner's \r overwrites.
// ---------------------------------------------------------------------------

function log(msg: string) {
  process.stderr.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// Base class for CLI-based LLM providers (Claude Code, future Codex)
// ---------------------------------------------------------------------------

interface SpawnOptions {
  timeoutMs?: number;
  /** Extra CLI args appended after base args */
  extraArgs?: string[];
}

interface CLIUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: string;
}

export abstract class BaseCLIProvider implements LLMProvider {
  abstract get binaryName(): string;
  abstract get baseArgs(): string[];
  abstract get modelFlag(): string[];

  private maxRetries = config.claudeCodeMaxRetries ?? 2;
  private debugDir: string | null = null;
  private callCounter = 0;
  private _analysisId: string | null = null;
  private _repoId: string | null = null;
  private _repoPath: string | null = null;
  private _abortSignal: AbortSignal | null = null;
  private _usageRecords: UsageRecord[] = [];

  setAnalysisId(id: string): void {
    this._analysisId = id;
    this._usageRecords = [];
  }

  setAbortSignal(signal: AbortSignal): void {
    this._abortSignal = signal;
  }

  /** Set repoId for child process tracking in the analysis registry. */
  setRepoId(repoId: string): void {
    this._repoId = repoId;
  }

  /** Set target repo path — used as cwd when spawning CLI so Read tool accesses the right files. */
  setRepoPath(path: string): void {
    this._repoPath = path;
  }

  async flushUsage(): Promise<void> {
    if (!this._analysisId || this._usageRecords.length === 0) return;
    const records: UsageData[] = this._usageRecords.map((r) => ({
      ...r,
      analysisId: this._analysisId!,
    }));
    await recordUsageBatch(records);
    this._usageRecords = [];
  }

  private collectUsage(callType: string, cliUsage: CLIUsage | undefined, durationMs: number): void {
    if (!cliUsage) return;
    this._usageRecords.push({
      provider: 'claude-code',
      callType,
      inputTokens: cliUsage.inputTokens,
      outputTokens: cliUsage.outputTokens,
      cacheReadTokens: cliUsage.cacheReadTokens,
      cacheWriteTokens: cliUsage.cacheWriteTokens,
      totalTokens: cliUsage.totalTokens,
      costUsd: cliUsage.costUsd,
      durationMs,
    });
  }

  constructor() {
    if (process.env.TRUECOURSE_CLI_DEBUG) {
      this.debugDir = join(tmpdir(), 'truecourse-cli-debug');
      mkdirSync(this.debugDir, { recursive: true });
      log(`[CLI] Debug output: ${this.debugDir}`);
    }
  }

  /** Write input prompt, schema, and raw output to debug files. */
  private dumpDebug(label: string, prompt: string, rawOutput: string, jsonSchema?: string) {
    if (!this.debugDir) return;
    const n = String(++this.callCounter).padStart(2, '0');
    const prefix = join(this.debugDir, `${n}-${label}`);
    writeFileSync(`${prefix}-input.txt`, prompt, 'utf-8');
    writeFileSync(`${prefix}-output.json`, rawOutput, 'utf-8');
    if (jsonSchema) writeFileSync(`${prefix}-schema.json`, jsonSchema, 'utf-8');
  }

  /** Strip nesting guard env vars so subprocess doesn't detect parent Claude Code. */
  protected getCleanEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE_CODE') || key.startsWith('CLAUDE_INTERNAL')) {
        delete env[key];
      }
    }
    return env;
  }

  /** Convert a Zod schema to JSON Schema string for --json-schema flag. */
  protected toJsonSchema(schema: ZodType): string {
    const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3' });
    return JSON.stringify(jsonSchema);
  }

  /** Spawn CLI subprocess, pipe prompt via stdin, collect stdout. */
  protected spawnCLI(prompt: string, jsonSchemaStr: string, opts?: SpawnOptions & { label?: string }): Promise<string> {
    // Check if already aborted before spawning
    if (this._abortSignal?.aborted) {
      return Promise.reject(new DOMException('Analysis cancelled', 'AbortError'));
    }

    const timeout = opts?.timeoutMs ?? config.claudeCodeTimeoutMs ?? 120_000;
    const label = opts?.label ?? 'call';
    const args = [
      ...this.baseArgs,
      ...this.modelFlag,
      '--json-schema', jsonSchemaStr,
      ...(opts?.extraArgs ?? []),
    ];

    return new Promise((resolve, reject) => {
      const child: ChildProcess = spawn(this.binaryName, args, {
        env: this.getCleanEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(this._repoPath ? { cwd: this._repoPath } : {}),
      });

      // Register child process for cancellation tracking
      if (this._repoId) {
        registerChildProcess(this._repoId, child);
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeout);

      // Listen for abort signal to kill the subprocess
      const onAbort = () => {
        aborted = true;
        clearTimeout(timer);
        if (!child.killed) child.kill('SIGTERM');
      };
      this._abortSignal?.addEventListener('abort', onAbort, { once: true });

      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        this._abortSignal?.removeEventListener('abort', onAbort);
        if (this._repoId) unregisterChildProcess(this._repoId, child);

        if (aborted) {
          reject(new DOMException('Analysis cancelled', 'AbortError'));
          return;
        }
        if (timedOut) {
          reject(new Error(`[CLI] ${label} timed out after ${timeout}ms`));
          return;
        }
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim().slice(0, 500);
          reject(new Error(`[CLI] ${this.binaryName} exited with code ${code}: ${detail}`));
          return;
        }
        resolve(stdout);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this._abortSignal?.removeEventListener('abort', onAbort);
        if (this._repoId) unregisterChildProcess(this._repoId, child);
        reject(new Error(`[CLI] Failed to spawn ${this.binaryName}: ${err.message}`));
      });

      // Pipe prompt via stdin
      child.stdin!.write(prompt);
      child.stdin!.end();
    });
  }

  /** Extract usage data from CLI JSON envelope if present. */
  private extractCLIUsage(parsed: Record<string, unknown>): CLIUsage | undefined {
    const usage = parsed.usage as Record<string, number> | undefined;
    if (!usage) return undefined;
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const costRaw = parsed.total_cost_usd;
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: input + output,
      costUsd: costRaw != null ? String(costRaw) : undefined,
    };
  }

  /**
   * Parse CLI output (--output-format json + --json-schema) and validate with Zod.
   * The response is a JSON envelope with structured_output containing validated data.
   */
  protected parseAndValidate<T>(raw: string, schema: ZodType<T>): { data: T; usage?: CLIUsage } {
    const parsed = JSON.parse(raw.trim());
    const usage = this.extractCLIUsage(parsed);

    if (parsed.is_error) {
      throw new Error(`[CLI] Agent returned error: ${parsed.result || parsed.subtype}`);
    }

    if (parsed.structured_output) {
      return { data: schema.parse(parsed.structured_output), usage };
    }

    // Fallback: try parsing the result field as JSON
    if (parsed.result) {
      const data = typeof parsed.result === 'string' ? JSON.parse(parsed.result) : parsed.result;
      return { data: schema.parse(data), usage };
    }

    throw new Error(`[CLI] No structured_output in response (subtype: ${parsed.subtype})`);
  }

  /** Spawn CLI with retry on parse/validation failure. */
  protected async spawnAndParse<T>(
    prompt: string,
    schema: ZodType<T>,
    opts?: SpawnOptions & { label?: string },
  ): Promise<{ data: T; usage?: CLIUsage }> {
    const jsonSchemaStr = this.toJsonSchema(schema);
    const label = opts?.label ?? 'call';
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const raw = await this.spawnCLI(prompt, jsonSchemaStr, opts);
        this.dumpDebug(label, prompt, raw, jsonSchemaStr);
        return this.parseAndValidate(raw, schema);
      } catch (err) {
        lastError = err as Error;
        if (this._abortSignal?.aborted) throw lastError; // don't retry on cancel
        if (attempt < this.maxRetries) {
          log(`[CLI] Attempt ${attempt + 1} failed, retrying... (${lastError.message})`);
        }
      }
    }

    throw lastError!;
  }

  // ---------------------------------------------------------------------------
  // LLMProvider implementation
  // ---------------------------------------------------------------------------

  async generateServiceViolations(context: ServiceViolationContext): Promise<ServiceViolationsResult> {
    const { vars, idMap } = buildServiceTemplateVars(context);
    const prompt = getPrompt('violations-service', vars);

    log('[CLI] Service violations call starting...');
    const t0 = Date.now();
    const { data: object, usage: cliUsage } = await this.spawnAndParse(prompt, ServiceViolationOutputSchema, {
      extraArgs: ['--tools', ''], label: 'service',
    });
    const dur = Date.now() - t0;
    log(`[CLI] Service violations call done in ${dur}ms — ${object.violations.length} violations`);
    this.collectUsage('service', cliUsage, dur);

    return {
      violations: object.violations.map((v) => ({
        id: randomUUID(),
        type: v.type,
        title: v.title,
        content: v.content,
        severity: v.severity,
        targetServiceId: resolveId(v.targetServiceId, idMap) ?? undefined,
        fixPrompt: v.fixPrompt ?? undefined,
        ruleKey: v.ruleKey ?? undefined,
        createdAt: new Date().toISOString(),
      })),
      serviceDescriptions: object.serviceDescriptions.map((d) => ({
        id: resolveId(d.id, idMap) || d.id,
        description: d.description,
      })),
    };
  }

  async generateDatabaseViolations(context: DatabaseViolationContext): Promise<DatabaseViolationsResult> {
    const { vars, idMap } = buildDatabaseTemplateVars(context);
    const prompt = getPrompt('violations-database', vars);

    log('[CLI] Database violations call starting...');
    const t0 = Date.now();
    const { data: object, usage: cliUsage } = await this.spawnAndParse(prompt, DatabaseViolationOutputSchema, {
      extraArgs: ['--tools', ''], label: 'database',
    });
    const dur = Date.now() - t0;
    log(`[CLI] Database violations call done in ${dur}ms — ${object.violations.length} violations`);
    this.collectUsage('database', cliUsage, dur);

    return {
      violations: object.violations.map((v) => ({
        id: randomUUID(),
        type: v.type,
        title: v.title,
        content: v.content,
        severity: v.severity,
        targetDatabaseId: resolveId(v.targetDatabaseId, idMap) ?? undefined,
        targetTable: v.targetTable ?? undefined,
        fixPrompt: v.fixPrompt ?? undefined,
        ruleKey: v.ruleKey ?? undefined,
        createdAt: new Date().toISOString(),
      })),
    };
  }

  async generateModuleViolations(context: ModuleViolationContext): Promise<ModuleViolationsResult> {
    const { vars, idMap } = buildModuleTemplateVars(context);
    const prompt = getPrompt('violations-module', vars);

    const moduleIdToServiceId = new Map(
      context.modules.filter((m) => m.serviceId).map((m) => [m.id, m.serviceId!]),
    );

    log(`[CLI] Module violations call starting (${context.modules.length} modules)...`);
    const t0 = Date.now();
    // Module context is a connected graph — use a longer timeout instead of batching
    // to avoid losing cross-module dependency edges
    const moduleTimeoutMs = 300_000; // 5 minutes
    const { data: object, usage: cliUsage } = await this.spawnAndParse(prompt, ModuleViolationOutputSchema, {
      extraArgs: ['--tools', ''], label: 'module', timeoutMs: moduleTimeoutMs,
    });
    const dur = Date.now() - t0;
    log(`[CLI] Module violations call done in ${dur}ms — ${object.violations.length} violations`);
    this.collectUsage('module', cliUsage, dur);

    return {
      violations: object.violations.map((v) => {
        const targetModuleId = resolveId(v.targetModuleId, idMap) ?? undefined;
        const targetServiceId = targetModuleId ? moduleIdToServiceId.get(targetModuleId) : undefined;
        return {
          id: randomUUID(),
          type: v.type,
          title: v.title,
          content: v.content,
          severity: v.severity,
          targetServiceId,
          targetModuleId,
          targetMethodId: resolveId(v.targetMethodId, idMap) ?? undefined,
          fixPrompt: v.fixPrompt ?? undefined,
          ruleKey: v.ruleKey ?? undefined,
          createdAt: new Date().toISOString(),
        };
      }),
    };
  }

  async generateAllViolations(contexts: AllViolationsInput): Promise<AllViolationsResult> {
    const onStepComplete = contexts.onStepComplete;
    const promises: [string, Promise<unknown>][] = [];

    if (contexts.service) {
      promises.push(['service', this.generateServiceViolations(contexts.service)]);
    }
    if (contexts.database) {
      promises.push(['database', this.generateDatabaseViolations(contexts.database)]);
    }
    if (contexts.module) {
      promises.push(['module', this.generateModuleViolations(contexts.module)]);
    }

    const stepLabels: Record<string, string> = {
      service: 'Service architecture checks done',
      database: 'Database schema checks done',
      module: 'Module & function checks done',
    };

    const settled = await Promise.allSettled(promises.map(([key, p]) =>
      p.then((v) => { onStepComplete?.(stepLabels[key] || `${key} done`); return v; })
    ));

    const result: AllViolationsResult = {};
    for (let i = 0; i < promises.length; i++) {
      const [key] = promises[i];
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        (result as Record<string, unknown>)[key] = outcome.value;
      } else {
        log(`[CLI Violations] ${key} call failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
      }
    }

    return result;
  }

  async generateAllViolationsWithLifecycle(
    contexts: AllViolationsInput,
    onStepComplete?: (step: string) => void,
  ): Promise<AllViolationsLifecycleResult> {
    const allResolved: string[] = [];
    const allNew: DiffViolationItem[] = [];
    let serviceDescriptions: ServiceDescription[] = [];

    const promises: [string, Promise<unknown>][] = [];
    const idMaps: Record<string, PromptIdMap> = {};

    // Service call
    if (contexts.service) {
      const ctx = contexts.service;
      if (ctx.existingViolations && ctx.existingViolations.length > 0) {
        promises.push(['service', (async () => {
          const { vars, idMap } = buildServiceTemplateVars(ctx);
          idMaps.service = idMap;
          const prompt = getPrompt('violations-service-lifecycle', vars);
          log('[CLI] Lifecycle service call starting...');
          const t0 = Date.now();
          const { data: object, usage: cliUsage } = await this.spawnAndParse(prompt, LifecycleServiceOutputSchema, {
            extraArgs: ['--tools', ''], label: 'service-lifecycle',
          });
          const dur = Date.now() - t0;
          log(`[CLI] Lifecycle service call done in ${dur}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
          this.collectUsage('service', cliUsage, dur);
          return object;
        })()]);
      } else {
        promises.push(['service-normal', this.generateServiceViolations(ctx)]);
      }
    }

    // Database call
    if (contexts.database) {
      const ctx = contexts.database;
      if (ctx.existingViolations && ctx.existingViolations.length > 0) {
        promises.push(['database', (async () => {
          const { vars, idMap } = buildDatabaseTemplateVars(ctx);
          idMaps.database = idMap;
          const prompt = getPrompt('violations-database-lifecycle', vars);
          log('[CLI] Lifecycle database call starting...');
          const t0 = Date.now();
          const { data: object, usage: cliUsage } = await this.spawnAndParse(prompt, DiffViolationOutputSchema, {
            extraArgs: ['--tools', ''], label: 'database-lifecycle',
          });
          const dur = Date.now() - t0;
          log(`[CLI] Lifecycle database call done in ${dur}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
          this.collectUsage('database', cliUsage, dur);
          return object;
        })()]);
      } else {
        promises.push(['database-normal', this.generateDatabaseViolations(ctx)]);
      }
    }

    // Module call
    if (contexts.module) {
      const ctx = contexts.module;
      if (ctx.existingViolations && ctx.existingViolations.length > 0) {
        const modIdToSvcId = new Map(
          ctx.modules.filter((m) => m.serviceId).map((m) => [m.id, m.serviceId!]),
        );
        promises.push(['module', (async () => {
          const { vars, idMap } = buildModuleTemplateVars(ctx);
          idMaps.module = idMap;
          const prompt = getPrompt('violations-module-lifecycle', vars);
          log('[CLI] Lifecycle module call starting...');
          const t0 = Date.now();
          const { data: object, usage: cliUsage } = await this.spawnAndParse(prompt, DiffViolationOutputSchema, {
            extraArgs: ['--tools', ''], label: 'module-lifecycle',
          });
          const dur = Date.now() - t0;
          log(`[CLI] Lifecycle module call done in ${dur}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
          this.collectUsage('module', cliUsage, dur);
          return {
            resolvedViolationIds: resolveIds(object.resolvedViolationIds, idMap),
            newViolations: object.newViolations.map((i) => {
              const realModuleId = resolveId(i.targetModuleId, idMap);
              return {
                ...i,
                targetServiceId: (realModuleId ? modIdToSvcId.get(realModuleId) : null) ?? null,
                targetModuleId: realModuleId ?? null,
                targetMethodId: resolveId(i.targetMethodId, idMap) ?? null,
                targetModuleName: i.targetModuleName ?? null,
                targetMethodName: i.targetMethodName ?? null,
              };
            }),
          };
        })()]);
      } else {
        promises.push(['module-normal', this.generateModuleViolations(ctx)]);
      }
    }

    const stepLabels: Record<string, string> = {
      service: 'Service checks done',
      'service-normal': 'Service checks done',
      database: 'Database checks done',
      'database-normal': 'Database checks done',
      module: 'Module checks done',
      'module-normal': 'Module checks done',
    };

    const settled = await Promise.allSettled(promises.map(([key, p]) =>
      p.then((v) => { onStepComplete?.(stepLabels[key] || `${key} done`); return v; })
    ));

    for (let i = 0; i < promises.length; i++) {
      const [key] = promises[i];
      const outcome = settled[i];
      if (outcome.status !== 'fulfilled') {
        log(`[CLI ViolationsLifecycle] ${key} call failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
        continue;
      }

      if (key === 'service') {
        const idMap = idMaps.service;
        const result = outcome.value as { resolvedViolationIds: string[]; newViolations: DiffViolationItem[]; serviceDescriptions: ServiceDescription[] };
        allResolved.push(...resolveIds(result.resolvedViolationIds, idMap));
        allNew.push(...result.newViolations.map((v) => ({
          ...v,
          targetServiceId: resolveId(v.targetServiceId, idMap) ?? null,
          targetModuleId: v.targetModuleId ?? null,
          targetMethodId: v.targetMethodId ?? null,
          targetServiceName: v.targetServiceName ?? null,
          targetModuleName: v.targetModuleName ?? null,
          targetMethodName: v.targetMethodName ?? null,
        })));
        serviceDescriptions = result.serviceDescriptions.map((d) => ({
          id: resolveId(d.id, idMap) || d.id,
          description: d.description,
        }));
      } else if (key === 'service-normal') {
        const result = outcome.value as ServiceViolationsResult;
        serviceDescriptions = result.serviceDescriptions;
        for (const v of result.violations) {
          allNew.push({
            type: v.type, title: v.title, content: v.content, severity: v.severity,
            targetServiceId: v.targetServiceId ?? null, targetModuleId: v.targetModuleId ?? null,
            targetMethodId: v.targetMethodId ?? null, targetServiceName: null,
            targetModuleName: null, targetMethodName: null, fixPrompt: v.fixPrompt ?? null,
            ruleKey: (v as Violation).ruleKey || 'unknown',
          });
        }
      } else if (key === 'database') {
        const idMap = idMaps.database;
        const result = outcome.value as DiffViolationsResult;
        allResolved.push(...resolveIds(result.resolvedViolationIds, idMap));
        allNew.push(...result.newViolations.map((v) => ({
          ...v,
          targetServiceId: v.targetServiceId ?? null,
          targetModuleId: v.targetModuleId ?? null,
          targetMethodId: v.targetMethodId ?? null,
          targetServiceName: v.targetServiceName ?? null,
          targetModuleName: v.targetModuleName ?? null,
          targetMethodName: v.targetMethodName ?? null,
        })));
      } else if (key === 'module') {
        const result = outcome.value as DiffViolationsResult;
        allResolved.push(...result.resolvedViolationIds);
        allNew.push(...result.newViolations.map((v) => ({
          ...v,
          targetServiceId: v.targetServiceId ?? null,
          targetModuleId: v.targetModuleId ?? null,
          targetMethodId: v.targetMethodId ?? null,
          targetServiceName: v.targetServiceName ?? null,
          targetModuleName: v.targetModuleName ?? null,
          targetMethodName: v.targetMethodName ?? null,
        })));
      } else {
        const result = outcome.value as DatabaseViolationsResult | ModuleViolationsResult;
        for (const v of result.violations) {
          allNew.push({
            type: v.type, title: v.title, content: v.content, severity: v.severity,
            targetServiceId: (v as Violation).targetServiceId ?? null,
            targetModuleId: (v as Violation).targetModuleId ?? null,
            targetMethodId: (v as Violation).targetMethodId ?? null,
            targetServiceName: null, targetModuleName: null, targetMethodName: null,
            fixPrompt: (v as Violation).fixPrompt ?? null,
            ruleKey: (v as Violation).ruleKey || 'unknown',
          });
        }
      }
    }

    return { resolvedViolationIds: allResolved, newViolations: allNew, serviceDescriptions };
  }

  async generateCodeViolations(context: CodeViolationContext): Promise<CodeViolationsResult> {
    const hasExisting = context.existingViolations && context.existingViolations.length > 0;
    let promptName: Parameters<typeof getPrompt>[0];
    if (context.tier === 'metadata') {
      promptName = hasExisting ? 'violations-code-metadata-lifecycle' : 'violations-code-metadata';
    } else if (context.tier === 'targeted') {
      promptName = hasExisting ? 'violations-code-targeted-lifecycle' : 'violations-code-targeted';
    } else {
      promptName = hasExisting ? 'violations-code-lifecycle' : 'violations-code';
    }

    // Only use file-path mode (Read tool) when files have real paths, not pre-built content
    // from the context router (which uses synthetic path 'context' for metadata/targeted tiers)
    const hasRealPaths = context.files.length > 0 && context.files.every((f) => f.path !== 'context');
    const { vars, idMap } = buildCodeTemplateVars(context, { useFilePaths: hasRealPaths });
    const prompt = getPrompt(promptName, vars);

    log(`[CLI] Code violations call starting (${context.files.length} files, ${hasExisting ? 'lifecycle' : 'first-run'})...`);
    const t0 = Date.now();

    // Only give Read tool access when files have real paths to read
    const codeExtraArgs = hasRealPaths ? ['--allowedTools', 'Read'] : ['--tools', ''];
    const codeTimeoutMs = 300_000; // 5 minutes — code review uses Read tool, takes many turns

    if (hasExisting) {
      const { data: object, usage: cliUsage } = await this.spawnAndParse(prompt, CodeViolationLifecycleOutputSchema, {
        extraArgs: codeExtraArgs, label: 'code-lifecycle', timeoutMs: codeTimeoutMs,
      });
      const dur = Date.now() - t0;
      log(`[CLI] Code violations call done in ${dur}ms — new: ${object.newViolations.length}, resolved: ${object.resolvedViolationIds.length}, unchanged: ${object.unchangedViolationIds.length}`);
      this.collectUsage('code', cliUsage, dur);

      return {
        violations: object.newViolations.map((v) => ({
          ruleKey: v.ruleKey,
          filePath: v.filePath,
          lineStart: v.lineStart,
          lineEnd: v.lineEnd,
          severity: v.severity,
          title: v.title,
          content: v.content,
          fixPrompt: v.fixPrompt ?? null,
        })),
        resolvedViolationIds: resolveIds(object.resolvedViolationIds, idMap),
        unchangedViolationIds: resolveIds(object.unchangedViolationIds, idMap),
      };
    }

    const { data: object, usage: cliUsage } = await this.spawnAndParse(prompt, CodeViolationOutputSchema, {
      extraArgs: codeExtraArgs, label: 'code', timeoutMs: codeTimeoutMs,
    });
    const dur = Date.now() - t0;
    log(`[CLI] Code violations call done in ${dur}ms — ${object.violations.length} violations`);
    this.collectUsage('code', cliUsage, dur);

    return {
      violations: object.violations.map((v) => ({
        ruleKey: v.ruleKey,
        filePath: v.filePath,
        lineStart: v.lineStart,
        lineEnd: v.lineEnd,
        severity: v.severity,
        title: v.title,
        content: v.content,
        fixPrompt: v.fixPrompt ?? null,
      })),
    };
  }

  async generateAllCodeViolations(batches: CodeViolationContext[]): Promise<CodeViolationsResult> {
    if (batches.length === 0) return { violations: [] };

    log(`[CLI] Code violations: ${batches.length} batch(es) starting...`);
    const t0 = Date.now();

    const results = await Promise.allSettled(
      batches.map((batch) => this.generateCodeViolations(batch))
    );

    const allViolations: CodeViolationRaw[] = [];
    const allResolved: string[] = [];
    const allUnchanged: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allViolations.push(...result.value.violations);
        if (result.value.resolvedViolationIds) allResolved.push(...result.value.resolvedViolationIds);
        if (result.value.unchangedViolationIds) allUnchanged.push(...result.value.unchangedViolationIds);
      } else {
        log(`[CLI CodeViolations] Batch call failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }

    log(`[CLI] Code violations total: ${Date.now() - t0}ms — new: ${allViolations.length}, resolved: ${allResolved.length}, unchanged: ${allUnchanged.length}`);
    return {
      violations: allViolations,
      resolvedViolationIds: allResolved.length > 0 ? allResolved : undefined,
      unchangedViolationIds: allUnchanged.length > 0 ? allUnchanged : undefined,
    };
  }

  async enrichFlow(context: FlowEnrichmentContext): Promise<FlowEnrichmentResult> {
    const prompt = getPrompt('flow-enrichment', buildFlowTemplateVars(context));

    log(`[CLI] Flow enrichment call starting for ${context.flowName}...`);
    const t0 = Date.now();
    const { data: object, usage: cliUsage } = await this.spawnAndParse(prompt, FlowEnrichmentOutputSchema, {
      extraArgs: ['--tools', ''], label: 'flow',
    });
    const dur = Date.now() - t0;
    log(`[CLI] Flow enrichment done in ${dur}ms`);
    this.collectUsage('flow', cliUsage, dur);

    return {
      name: object.name,
      description: object.description,
      stepDescriptions: object.stepDescriptions,
    };
  }
}

// ---------------------------------------------------------------------------
// Claude Code provider
// ---------------------------------------------------------------------------

export class ClaudeCodeProvider extends BaseCLIProvider {
  get binaryName(): string {
    return config.claudeCodeBinary ?? 'claude';
  }

  get baseArgs(): string[] {
    return [
      '--print',
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
    ];
  }

  get modelFlag(): string[] {
    const model = config.claudeCodeModel;
    return model ? ['--model', model] : [];
  }
}
