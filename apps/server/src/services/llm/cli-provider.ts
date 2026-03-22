import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { v4 as uuidv4 } from 'uuid';
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
  buildEnrichmentTemplateVars,
  resolveId,
  resolveIds,
  type FlowEnrichmentContext,
  type DeterministicDetectionForEnrichment,
  type PromptIdMap,
} from './prompts.js';
import {
  ServiceViolationOutputSchema,
  DatabaseViolationOutputSchema,
  ModuleViolationOutputSchema,
  DiffViolationOutputSchema,
  LifecycleServiceOutputSchema,
  EnrichmentOutputSchema,
  CodeViolationOutputSchema,
  CodeViolationLifecycleOutputSchema,
  FlowEnrichmentOutputSchema,
} from './schemas.js';
import type {
  LLMProvider,
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
  EnrichmentResult,
  FlowEnrichmentResult,
  DiffViolationItem,
  DiffViolationsResult,
  ServiceDescription,
  ChatMessage,
} from './provider.js';

// ---------------------------------------------------------------------------
// Base class for CLI-based LLM providers (Claude Code, future Codex)
// ---------------------------------------------------------------------------

interface SpawnOptions {
  timeoutMs?: number;
  /** Extra CLI args appended after base args */
  extraArgs?: string[];
}

export abstract class BaseCLIProvider implements LLMProvider {
  abstract get binaryName(): string;
  abstract get baseArgs(): string[];
  abstract get modelFlag(): string[];

  private maxRetries = config.claudeCodeMaxRetries ?? 2;
  private debugDir: string | null = null;
  private callCounter = 0;

  constructor() {
    if (process.env.TRUECOURSE_CLI_DEBUG) {
      this.debugDir = join(tmpdir(), 'truecourse-cli-debug');
      mkdirSync(this.debugDir, { recursive: true });
      console.log(`[CLI] Debug output: ${this.debugDir}`);
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
  protected spawnCLI(prompt: string, jsonSchemaStr: string, opts?: SpawnOptions): Promise<string> {
    const timeout = opts?.timeoutMs ?? config.claudeCodeTimeoutMs ?? 120_000;
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
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeout);

      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`[CLI] ${this.binaryName} timed out after ${timeout}ms`));
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
        reject(new Error(`[CLI] Failed to spawn ${this.binaryName}: ${err.message}`));
      });

      // Pipe prompt via stdin
      child.stdin!.write(prompt);
      child.stdin!.end();
    });
  }

  /**
   * Parse CLI output (--output-format json + --json-schema) and validate with Zod.
   * The response is a JSON envelope with structured_output containing validated data.
   */
  protected parseAndValidate<T>(raw: string, schema: ZodType<T>): T {
    const parsed = JSON.parse(raw.trim());

    if (parsed.is_error) {
      throw new Error(`[CLI] Agent returned error: ${parsed.result || parsed.subtype}`);
    }

    if (parsed.structured_output) {
      return schema.parse(parsed.structured_output);
    }

    // Fallback: try parsing the result field as JSON
    if (parsed.result) {
      const data = typeof parsed.result === 'string' ? JSON.parse(parsed.result) : parsed.result;
      return schema.parse(data);
    }

    throw new Error(`[CLI] No structured_output in response (subtype: ${parsed.subtype})`);
  }

  /** Spawn CLI with retry on parse/validation failure. */
  protected async spawnAndParse<T>(
    prompt: string,
    schema: ZodType<T>,
    opts?: SpawnOptions & { label?: string },
  ): Promise<T> {
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
        if (attempt < this.maxRetries) {
          console.warn(`[CLI] Attempt ${attempt + 1} failed, retrying... (${lastError.message})`);
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
    const { text: prompt } = await getPrompt('violations-service', vars);

    console.log('[CLI] Service violations call starting...');
    const t0 = Date.now();
    const object = await this.spawnAndParse(prompt, ServiceViolationOutputSchema, {
      extraArgs: ['--tools', ''], label: 'service',
    });
    console.log(`[CLI] Service violations call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

    return {
      violations: object.violations.map((v) => ({
        id: uuidv4(),
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
    const { text: prompt } = await getPrompt('violations-database', vars);

    console.log('[CLI] Database violations call starting...');
    const t0 = Date.now();
    const object = await this.spawnAndParse(prompt, DatabaseViolationOutputSchema, {
      extraArgs: ['--tools', ''], label: 'database',
    });
    console.log(`[CLI] Database violations call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

    return {
      violations: object.violations.map((v) => ({
        id: uuidv4(),
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
    const { text: prompt } = await getPrompt('violations-module', vars);

    const moduleIdToServiceId = new Map(
      context.modules.filter((m) => m.serviceId).map((m) => [m.id, m.serviceId!]),
    );

    console.log('[CLI] Module violations call starting...');
    const t0 = Date.now();
    const object = await this.spawnAndParse(prompt, ModuleViolationOutputSchema, {
      extraArgs: ['--tools', ''], label: 'module',
    });
    console.log(`[CLI] Module violations call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

    return {
      violations: object.violations.map((v) => {
        const targetModuleId = resolveId(v.targetModuleId, idMap) ?? undefined;
        const targetServiceId = targetModuleId ? moduleIdToServiceId.get(targetModuleId) : undefined;
        return {
          id: uuidv4(),
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
        console.error(`[CLI Violations] ${key} call failed:`, outcome.reason);
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
          const { text: prompt } = await getPrompt('violations-service-lifecycle', vars);
          console.log('[CLI] Lifecycle service call starting...');
          const t0 = Date.now();
          const object = await this.spawnAndParse(prompt, LifecycleServiceOutputSchema, {
            extraArgs: ['--tools', ''], label: 'service-lifecycle',
          });
          console.log(`[CLI] Lifecycle service call done in ${Date.now() - t0}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
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
          const { text: prompt } = await getPrompt('violations-database-lifecycle', vars);
          console.log('[CLI] Lifecycle database call starting...');
          const t0 = Date.now();
          const object = await this.spawnAndParse(prompt, DiffViolationOutputSchema, {
            extraArgs: ['--tools', ''], label: 'database-lifecycle',
          });
          console.log(`[CLI] Lifecycle database call done in ${Date.now() - t0}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
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
          const { text: prompt } = await getPrompt('violations-module-lifecycle', vars);
          console.log('[CLI] Lifecycle module call starting...');
          const t0 = Date.now();
          const object = await this.spawnAndParse(prompt, DiffViolationOutputSchema, {
            extraArgs: ['--tools', ''], label: 'module-lifecycle',
          });
          console.log(`[CLI] Lifecycle module call done in ${Date.now() - t0}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
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
        console.error(`[CLI ViolationsLifecycle] ${key} call failed:`, outcome.reason);
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
    const promptName = hasExisting ? 'violations-code-lifecycle' : 'violations-code';
    const { vars, idMap } = buildCodeTemplateVars(context, { useFilePaths: true });
    const { text: prompt } = await getPrompt(promptName, vars);

    console.log(`[CLI] Code violations call starting (${context.files.length} files, ${hasExisting ? 'lifecycle' : 'first-run'})...`);
    const t0 = Date.now();

    // Code violations use Read tool access (no --bare, --allowedTools "Read")
    const codeExtraArgs = ['--allowedTools', 'Read'];

    if (hasExisting) {
      const object = await this.spawnAndParse(prompt, CodeViolationLifecycleOutputSchema, {
        extraArgs: codeExtraArgs, label: 'code-lifecycle',
      });
      console.log(`[CLI] Code violations call done in ${Date.now() - t0}ms — new: ${object.newViolations.length}, resolved: ${object.resolvedViolationIds.length}, unchanged: ${object.unchangedViolationIds.length}`);

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

    const object = await this.spawnAndParse(prompt, CodeViolationOutputSchema, {
      extraArgs: codeExtraArgs, label: 'code',
    });
    console.log(`[CLI] Code violations call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

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

    console.log(`[CLI] Code violations: ${batches.length} batch(es) starting...`);
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
        console.error('[CLI CodeViolations] Batch call failed:', result.reason);
      }
    }

    console.log(`[CLI] Code violations total: ${Date.now() - t0}ms — new: ${allViolations.length}, resolved: ${allResolved.length}, unchanged: ${allUnchanged.length}`);
    return {
      violations: allViolations,
      resolvedViolationIds: allResolved.length > 0 ? allResolved : undefined,
      unchangedViolationIds: allUnchanged.length > 0 ? allUnchanged : undefined,
    };
  }

  async enrichDeterministicViolations(
    detections: DeterministicDetectionForEnrichment[],
    architectureContext: string,
  ): Promise<EnrichmentResult> {
    if (detections.length === 0) return { enrichedViolations: [] };

    const { vars, idMap } = buildEnrichmentTemplateVars(detections, architectureContext);
    const { text: prompt } = await getPrompt('violations-enrich-deterministic', vars);

    console.log(`[CLI] Enrichment call starting for ${detections.length} detections...`);
    const t0 = Date.now();
    const object = await this.spawnAndParse(prompt, EnrichmentOutputSchema, {
      extraArgs: ['--tools', ''], label: 'enrichment',
    });
    console.log(`[CLI] Enrichment call done in ${Date.now() - t0}ms — ${object.enrichedViolations.length} enriched`);

    return {
      enrichedViolations: object.enrichedViolations.map((e) => ({
        ...e,
        id: resolveId(e.id, idMap) || e.id,
      })),
    };
  }

  async enrichFlow(context: FlowEnrichmentContext): Promise<FlowEnrichmentResult> {
    const { text: prompt } = await getPrompt('flow-enrichment', buildFlowTemplateVars(context));

    console.log(`[CLI] Flow enrichment call starting for ${context.flowName}...`);
    const t0 = Date.now();
    const object = await this.spawnAndParse(prompt, FlowEnrichmentOutputSchema, {
      extraArgs: ['--tools', ''], label: 'flow',
    });
    console.log(`[CLI] Flow enrichment done in ${Date.now() - t0}ms`);

    return {
      name: object.name,
      description: object.description,
      stepDescriptions: object.stepDescriptions,
    };
  }

  async *chat(
    messages: ChatMessage[],
    systemPrompt: string,
  ): AsyncGenerator<string> {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
      '--system-prompt', systemPrompt,
      ...this.modelFlag,
    ];

    // Flatten messages into a single prompt for --print mode
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');

    const child = spawn(this.binaryName, args, {
      env: this.getCleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin!.write(prompt);
    child.stdin!.end();

    // Parse stream-json events line by line
    let buffer = '';
    for await (const chunk of child.stdout!) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop()!; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          // Yield assistant text content from stream events
          if (event.type === 'assistant' && event.message) {
            yield event.message;
          } else if (event.type === 'result' && event.result) {
            yield event.result;
          }
        } catch {
          // Skip non-JSON lines
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        if (event.type === 'result' && event.result) {
          yield event.result;
        }
      } catch {
        // Skip
      }
    }
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
