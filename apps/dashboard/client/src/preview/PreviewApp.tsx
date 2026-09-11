/**
 * The preview's root: the shell, the routes, and the job toasts that announce
 * a started job with a link to the agent's page.
 *
 * ROUTING: this is a DESCENDANT route set, mounted at `/preview/*` by the real
 * app's router, so every path here is relative to `/preview` and this component
 * brings no router of its own. That is what lets a test render it under a
 * MemoryRouter, and it is why the shell's links are written absolute.
 *
 * A repository address without a tab lands on Tests, and a settings
 * address without a sub-tab lands on Members: the two defaults are expressed as
 * routes rather than redirects, so a bare address is a place, not a bounce.
 *
 * `/context/source/:id` is the one REDIRECT here: a source is not a page of its
 * own — it is Context narrowed to it — so the address resolves to that.
 */

import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import AdminPage from './pages/AdminPage';
import AgentPage from './pages/AgentPage';
import ConflictsPage from './pages/ConflictsPage';
import ContextConflictPage from './pages/ContextConflictPage';
import ContextDocPage from './pages/ContextDocPage';
import DocumentsPage from './pages/DocumentsPage';
import HomePage from './pages/HomePage';
import KnowledgePage from './pages/KnowledgePage';
import NotificationsPage from './pages/NotificationsPage';
import SettingsPage from './pages/SettingsPage';
import RepoConsole from './repo/RepoConsole';
import { JobToasts } from './shell/JobToasts';
import { installPreviewFetch } from './data/fake-api';

installPreviewFetch();
import { PreviewShell } from './shell/PreviewShell';
import { PreviewStateProvider } from './shell/preview-state';

function AgentRunRoute() {
  const { runId } = useParams<{ runId: string }>();
  return <AgentPage runId={runId ? decodeURIComponent(runId) : undefined} />;
}

/** One document of Context, by the corpus ref in the address. */
function ContextDocRoute() {
  const { docRef } = useParams<{ docRef: string }>();
  return <ContextDocPage docRef={docRef ? decodeURIComponent(docRef) : ''} />;
}

/** One conflict of the workspace corpus, with its resolver. */
function ContextConflictRoute() {
  const { conflictId } = useParams<{ conflictId: string }>();
  return <ContextConflictPage conflictId={conflictId ? decodeURIComponent(conflictId) : ''} />;
}

/** A source is not a page: it is Context narrowed to it. */
function ContextSourceRedirect() {
  const { sourceId } = useParams<{ sourceId: string }>();
  return (
    <Navigate replace to={`/preview/context?source=${encodeURIComponent(sourceId ?? '')}`} />
  );
}

function KnowledgeItemRoute({ kind }: { kind: 'doc' | 'conflict' }) {
  const { docRef, conflictId } = useParams<{ docRef?: string; conflictId?: string }>();
  const id = kind === 'doc' ? docRef : conflictId;
  return <KnowledgePage kind={kind} itemId={id ? decodeURIComponent(id) : undefined} />;
}

export function PreviewRoutes() {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="agent" element={<AgentPage />} />
      <Route path="agent/:runId" element={<AgentRunRoute />} />
      <Route path="context" element={<DocumentsPage />} />
      <Route path="context/conflicts" element={<ConflictsPage />} />
      <Route path="context/conflicts/:conflictId" element={<ContextConflictRoute />} />
      <Route path="context/doc/:docRef" element={<ContextDocRoute />} />
      <Route path="context/source/:sourceId" element={<ContextSourceRedirect />} />
      <Route path="knowledge" element={<KnowledgePage />} />
      <Route path="knowledge/sources" element={<KnowledgePage tab="sources" />} />
      <Route path="knowledge/doc/:docRef" element={<KnowledgeItemRoute kind="doc" />} />
      <Route path="knowledge/conflict/:conflictId" element={<KnowledgeItemRoute kind="conflict" />} />
      <Route path="repos/:slug" element={<RepoConsole />} />
      <Route path="repos/:slug/:tab" element={<RepoConsole />} />
      <Route path="repos/:slug/runs/:runId" element={<RepoConsole />} />
      <Route path="repos/:slug/tests/:flowId" element={<RepoConsole />} />
      <Route path="repos/:slug/interfaces/:interfaceId" element={<RepoConsole />} />
      <Route path="repos/:slug/dependencies/:dependencyName" element={<RepoConsole />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="settings/:tab" element={<SettingsPage />} />
      <Route path="notifications" element={<NotificationsPage />} />
      <Route path="admin" element={<AdminPage />} />
      <Route path="admin/traces" element={<AdminPage tab="traces" />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}

export default function PreviewApp() {
  return (
    <PreviewStateProvider>
      <PreviewShell>
        <PreviewRoutes />
      </PreviewShell>
      <JobToasts />
    </PreviewStateProvider>
  );
}
