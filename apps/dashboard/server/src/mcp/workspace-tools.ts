/**
 * The WORKSPACE's tools: its repositories, its documents and their sections,
 * the conflicts between them, its documentation sources, and the decisions a
 * person makes about all of those.
 *
 * Each tool calls the service the matching dashboard route calls — the
 * Documents view, the Context source operations, the corpus decisions — and
 * answers a compact projection of what that service returns.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildDocSectionIndex } from '@truecourse/guard-runner';
import { readContextDocByRef } from '@truecourse/core/lib/context-store';
import {
  CONTEXT_SOURCE_KINDS,
  type ContextDocumentRow,
  type ContextSource,
  type ContextSourceView,
  type CorpusConflict,
  type OverlapLike,
} from '@truecourse/shared';
import {
  addSource,
  editSource,
  listSources,
  listWorkspaceDocuments,
  pauseSource,
  readSource,
  removeSource,
  syncSource,
} from '../services/context-sources.service.js';
import {
  excludeDocument,
  includeDocument,
  resolveConflict,
  unexcludeDocument,
  unincludeDocument,
  unresolveConflict,
  workspaceConflicts,
  workspaceStaleness,
} from '../services/context-decisions.service.js';
import { listRepositorySummaries } from '../services/repositories.service.js';
import { contextCallerOf, run, ToolRefusal, type McpCaller } from './caller.js';

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** One Documents-view row, as a model reads it. */
function documentRow(row: ContextDocumentRow) {
  return {
    ref: row.ref,
    title: row.title,
    area: row.area,
    source: { id: row.sourceId, title: row.sourceTitle, kind: row.sourceKind },
    status: row.status,
    readings: row.readings,
    inclusion: row.inclusion,
    decision: row.decision,
    ...(row.skipReason ? { skipReason: row.skipReason } : {}),
    updatedAt: row.updatedAt,
  };
}

/** One source, as a model reads it. */
function sourceRow(source: ContextSource | ContextSourceView) {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    status: source.status,
    ...(source.statusNote ? { statusNote: source.statusNote } : {}),
    lastSyncAt: source.lastSyncAt ?? null,
    config: source.config,
    ...('docCount' in source ? { documents: source.docCount, repositories: source.repositories } : {}),
  };
}

/** One conflict with both of its sides. */
function conflictRow(conflict: CorpusConflict<OverlapLike & { review?: unknown }>) {
  const side = (doc: string) => {
    const section = (conflict.overlap.sections ?? []).find((s) => s.doc === doc);
    return {
      doc,
      heading: section?.heading ?? null,
      ...(section?.quote ? { quote: section.quote } : {}),
    };
  };
  return {
    id: conflict.id,
    area: conflict.area,
    note: conflict.note,
    a: side(conflict.a),
    b: side(conflict.b),
    ...(conflict.overlap.review ? { review: conflict.overlap.review } : {}),
    resolved: conflict.resolved,
    ...(conflict.resolution
      ? {
          resolution: {
            verdict: conflict.resolution.verdict,
            ...(conflict.resolution.resolvedBy ? { by: conflict.resolution.resolvedBy } : {}),
            ...(conflict.resolution.resolvedAt ? { at: conflict.resolution.resolvedAt } : {}),
            ...(conflict.resolution.note ? { note: conflict.resolution.note } : {}),
          },
        }
      : {}),
    ...(conflict.excludedRef ? { excludedRef: conflict.excludedRef } : {}),
  };
}

/** The conflict an id names, or a refusal pointing at the list. */
async function requireConflict(org: string, id: string) {
  const conflict = (await workspaceConflicts(org)).find((c) => c.id === id);
  if (!conflict) {
    throw new ToolRefusal(`No conflict "${id}" in this workspace's corpus. list_conflicts names them.`);
  }
  return conflict;
}

const statusWords = ['proved', 'failed', 'blocked', 'not-testable', 'not-run', 'not-linked'] as const;
const inclusionWords = ['in-corpus', 'not-included', 'excluded'] as const;

export function registerWorkspaceTools(server: McpServer, caller: McpCaller): void {
  const org = caller.org;

  server.registerTool(
    'list_repositories',
    {
      title: 'List repositories',
      description:
        "The repositories connected to this TrueCourse workspace. Every repository tool takes one of these by its `id` (or its `owner/repo` name). `latestEvent` is the repository's most recent Flow generation or Flow run.",
      annotations: READ,
    },
    () =>
      run('list_repositories', async () => ({
        repositories: (await listRepositorySummaries(caller.repoLinks, org)).map((r) => ({
          id: r.id,
          name: r.name,
          provider: r.provider ?? null,
          defaultBranch: r.defaultBranch,
          latestEvent: r.latestEvent,
        })),
      })),
  );

  server.registerTool(
    'list_documents',
    {
      title: 'List documents',
      description:
        "The workspace's documents: every document its sources yielded, whether the corpus holds it (`inclusion`), the person's force-include/exclude decision if any, and its coverage `status` folded worst-first across the repositories that read it (proved, failed, blocked, not-testable, not-run, not-linked). `stale` says the sources changed since the corpus was last scanned. Filters combine with AND; values within one filter with OR.",
      inputSchema: {
        status: z.array(z.enum(statusWords)).optional().describe('Only documents with one of these coverage statuses.'),
        inclusion: z.array(z.enum(inclusionWords)).optional().describe('Only documents with one of these inclusion states.'),
        area: z.array(z.string()).optional().describe('Only documents tagged with one of these areas.'),
        source: z.array(z.string()).optional().describe('Only documents from one of these source ids.'),
        repo: z.array(z.string()).optional().describe('Only documents one of these repositories (`owner/repo`) reads.'),
      },
      annotations: READ,
    },
    (args) =>
      run('list_documents', async () => {
        const [view, staleness] = await Promise.all([
          listWorkspaceDocuments(contextCallerOf(caller), {
            status: args.status ?? [],
            inclusion: args.inclusion ?? [],
            area: args.area ?? [],
            source: args.source ?? [],
            repo: args.repo ?? [],
          }),
          workspaceStaleness(org),
        ]);
        return {
          corpusAt: view.corpusAt,
          stale: staleness.stale,
          documents: view.documents.map(documentRow),
        };
      }),
  );

  server.registerTool(
    'read_document',
    {
      title: 'Read a document',
      description:
        "One document's text, by its `ref` from list_documents. Without `section`, the whole document plus its section outline (each section's `anchor`, heading and lines). With `section` (an anchor from that outline, or from a flow milestone), only that section's text — a section runs from its heading to the next heading of the same or higher level.",
      inputSchema: {
        ref: z.string().describe('The document ref, `context/<source>/<path>`.'),
        section: z.string().optional().describe('A section anchor, to read that section alone.'),
      },
      annotations: READ,
    },
    (args) =>
      run('read_document', async () => {
        const content = await readContextDocByRef(org, args.ref);
        if (content === null) throw new ToolRefusal(`No document "${args.ref}" in this workspace.`);
        const index = buildDocSectionIndex(args.ref, content);
        const outline = index.sections.map((s) => ({
          anchor: s.anchor,
          heading: s.headingText,
          level: s.level,
          lines: [s.startLine, s.endLine],
        }));
        if (args.section === undefined) return { ref: args.ref, sections: outline, content };
        const section = index.sections.find((s) => s.anchor === args.section);
        if (!section) {
          throw new ToolRefusal(
            `No section "${args.section}" in ${args.ref}. Its sections: ${outline.map((s) => s.anchor).join(', ')}.`,
          );
        }
        const lines = content.split('\n').slice(section.startLine - 1, section.endLine);
        return {
          ref: args.ref,
          section: { anchor: section.anchor, heading: section.headingText, lines: [section.startLine, section.endLine] },
          content: lines.join('\n'),
        };
      }),
  );

  server.registerTool(
    'list_conflicts',
    {
      title: 'List conflicts',
      description:
        "Places where two documents of the corpus disagree. Each conflict has an `id`, the two sides `a` and `b` (document, section heading, the disputed quote), the scan's note and, when it has one, its `review` (an explanation and a recommended action). An OPEN conflict stops Flow generation in every repository that reads both documents until someone resolves it. Open ones only unless `includeResolved`.",
      inputSchema: {
        includeResolved: z.boolean().optional().describe('Also list conflicts already resolved.'),
      },
      annotations: READ,
    },
    (args) =>
      run('list_conflicts', async () => ({
        conflicts: (await workspaceConflicts(org))
          .filter((c) => args.includeResolved === true || !c.resolved)
          .map(conflictRow),
      })),
  );

  server.registerTool(
    'resolve_conflict',
    {
      title: 'Resolve a conflict',
      description:
        "Record a verdict on one conflict from list_conflicts: `a` (side A's document is right; B's disputed claim is dropped), `b` (side B is right), or `dismissed` (not a real conflict; nothing is dropped). When this clears the last open conflict a stopped Flow generation was waiting on, that generation starts again.",
      inputSchema: {
        conflictId: z.string().describe('The conflict id from list_conflicts.'),
        verdict: z.enum(['a', 'b', 'dismissed']),
        note: z.string().optional().describe('Why, in a sentence.'),
      },
      annotations: WRITE,
    },
    (args) =>
      run('resolve_conflict', async () => {
        const conflict = await requireConflict(org, args.conflictId);
        const section = (doc: string) => (conflict.overlap.sections ?? []).find((s) => s.doc === doc);
        await resolveConflict(
          { org, userId: caller.user.id },
          {
            docA: conflict.a,
            anchorA: section(conflict.a)?.heading ?? null,
            quoteA: section(conflict.a)?.quote,
            docB: conflict.b,
            anchorB: section(conflict.b)?.heading ?? null,
            quoteB: section(conflict.b)?.quote,
            verdict: args.verdict,
            ...(args.note ? { note: args.note } : {}),
          },
        );
        return { conflict: conflictRow(await requireConflict(org, args.conflictId)) };
      }),
  );

  server.registerTool(
    'undo_conflict_resolution',
    {
      title: 'Undo a conflict resolution',
      description:
        'Withdraw the verdict on one conflict, so it is open again. Only a verdict can be withdrawn here; a conflict resolved because one of its documents was force-excluded opens again by undoing that exclusion (set_document_decision).',
      inputSchema: { conflictId: z.string().describe('The conflict id from list_conflicts.') },
      annotations: WRITE,
    },
    (args) =>
      run('undo_conflict_resolution', async () => {
        const conflict = await requireConflict(org, args.conflictId);
        if (!conflict.resolution) {
          throw new ToolRefusal(
            conflict.excludedRef
              ? `This conflict is resolved because ${conflict.excludedRef} is excluded, not by a verdict.`
              : 'This conflict has no verdict to withdraw.',
          );
        }
        const { docA, anchorA, docB, anchorB } = conflict.resolution;
        await unresolveConflict(org, { docA, anchorA, docB, anchorB });
        return { conflict: conflictRow(await requireConflict(org, args.conflictId)) };
      }),
  );

  server.registerTool(
    'set_document_decision',
    {
      title: 'Include or exclude a document',
      description:
        "Decide whether a document belongs in the corpus, overriding the scan: `include` forces it in, `exclude` forces it out, `undo-include` / `undo-exclude` withdraw that decision. The corpus changes at the next document scan, which is started from the dashboard; until then list_documents reports `stale`. Excluding a document also resolves every conflict it is a side of.",
      inputSchema: {
        ref: z.string().describe('The document ref from list_documents.'),
        decision: z.enum(['include', 'exclude', 'undo-include', 'undo-exclude']),
      },
      annotations: WRITE,
    },
    (args) =>
      run('set_document_decision', async () => {
        const write = {
          include: includeDocument,
          exclude: excludeDocument,
          'undo-include': unincludeDocument,
          'undo-exclude': unexcludeDocument,
        }[args.decision];
        return write(org, args.ref);
      }),
  );

  server.registerTool(
    'list_sources',
    {
      title: 'List documentation sources',
      description:
        "Where the workspace's documents come from: each source's `id`, kind, title, sync status, how many documents it holds and which repositories read it. `addableKinds` are the kinds add_source accepts on this server.",
      annotations: READ,
    },
    () =>
      run('list_sources', async () => {
        const listing = await listSources(org);
        return {
          sources: listing.sources.map(sourceRow),
          changedAt: listing.changedAt,
          addableKinds: listing.addableKinds,
        };
      }),
  );

  server.registerTool(
    'get_source',
    {
      title: 'Get a documentation source',
      description: 'One source and its recent syncs (newest first), each with what it added, changed and removed.',
      inputSchema: { sourceId: z.string() },
      annotations: READ,
    },
    (args) =>
      run('get_source', async () => {
        const { source, syncs } = await readSource(org, args.sourceId);
        return { source: sourceRow(source), syncs };
      }),
  );

  server.registerTool(
    'add_source',
    {
      title: 'Add a documentation source',
      description:
        "Add a source of documents and sync it (unless `sync` is false, which adds it paused). `config` depends on `kind`: a `site` is `{ llmsTxtUrl }` (a documentation site's llms.txt); a `repository` is `{ repoFullName, branch?, include?, exclude? }` (glob patterns). Other kinds are the edition's own and take their own config. `repoIds` are the repositories that should read it. Refused until the workspace has said what its product is (Settings › Workspace).",
      inputSchema: {
        kind: z.enum(CONTEXT_SOURCE_KINDS),
        config: z.record(z.unknown()),
        repoIds: z.array(z.string()).optional().describe('Repository ids or `owner/repo` names that read this source.'),
        sync: z.boolean().optional().describe('False adds it paused, without syncing.'),
      },
      annotations: WRITE,
    },
    (args) =>
      run('add_source', async () => {
        const added = await addSource(contextCallerOf(caller), args);
        return { source: sourceRow(added.source), ...(added.jobId ? { syncJobId: added.jobId } : {}) };
      }),
  );

  server.registerTool(
    'edit_source',
    {
      title: 'Edit a documentation source',
      description:
        "Replace a source's `config` (same shape add_source takes for its kind) and sync it with the new scope. A repository source keeps its repository; its branch and patterns can change. A paused source stores the scope and syncs when resumed.",
      inputSchema: { sourceId: z.string(), config: z.record(z.unknown()) },
      annotations: WRITE,
    },
    (args) =>
      run('edit_source', async () => {
        const edited = await editSource(org, args.sourceId, args.config);
        return {
          source: sourceRow(edited.source),
          ...(edited.jobId ? { syncJobId: edited.jobId } : {}),
          ...(edited.note ? { note: edited.note } : {}),
        };
      }),
  );

  server.registerTool(
    'pause_source',
    {
      title: 'Pause or resume a documentation source',
      description: 'Pause a source (nothing syncs it) or resume it (`paused: false`).',
      inputSchema: { sourceId: z.string(), paused: z.boolean() },
      annotations: WRITE,
    },
    (args) =>
      run('pause_source', async () => {
        const { source } = await pauseSource(org, args.sourceId, args.paused);
        return { source: source ? sourceRow(source) : null };
      }),
  );

  server.registerTool(
    'sync_source',
    {
      title: 'Sync a documentation source now',
      description: "Fetch a source's documents again now. Refused while it is paused or already syncing.",
      inputSchema: { sourceId: z.string() },
      annotations: WRITE,
    },
    (args) => run('sync_source', async () => ({ syncJobId: (await syncSource(org, args.sourceId)).jobId })),
  );

  server.registerTool(
    'delete_source',
    {
      title: 'Delete a documentation source',
      description:
        'Delete a source, its documents and every repository link to it, and start a document scan so the corpus drops its documents. Cannot be undone.',
      inputSchema: { sourceId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    (args) =>
      run('delete_source', async () => {
        const removed = await removeSource(org, args.sourceId);
        return {
          removed: sourceRow(removed.removed),
          repositories: removed.repositories,
          ...(removed.jobId ? { scanJobId: removed.jobId } : {}),
        };
      }),
  );
}
