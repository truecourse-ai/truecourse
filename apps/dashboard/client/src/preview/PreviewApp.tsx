/**
 * The preview's root: the shell, the routes, and the job toasts that announce
 * a started job with a link to the agent's page.
 *
 * ROUTING: this is a DESCENDANT route set, mounted at `/preview/*` by the real
 * app's router, so every path here is relative to `/preview` and this component
 * brings no router of its own. That is what lets a test render it under a
 * MemoryRouter, and it is why the shell's links are written absolute.
 *
 * A repository address without a tab lands on Runs, and a settings
 * address without a sub-tab lands on Members: the two defaults are expressed as
 * routes rather than redirects, so a bare address is a place, not a bounce.
 *
 * The repositories are Code (`/code`) and the flows of every one of them are
 * Flows (`/flows`, one flow at `/flows/:flowId?repo=`): neither is a tab of the
 * other, and Home is the product owner's dashboard, which is not built yet.
 *
 * Context LANDS on its sources (`/context`), each source is a page of its own
 * (`/context/sources/:id`), and their documents are a place of their own
 * (`/context/documents`, narrowed by the query the filter row writes). The one
 * REDIRECT here is the older singular address, `/context/source/:id`, which
 * resolves to the source's page.
 */

import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import AdminPage from './pages/AdminPage';
import AgentPage from './pages/AgentPage';
import CodePage from './pages/CodePage';
import ConflictsPage from './pages/ConflictsPage';
import ContextConflictPage from './pages/ContextConflictPage';
import ContextDocPage from './pages/ContextDocPage';
import DocumentsPage from './pages/DocumentsPage';
import FlowsPage from './pages/FlowsPage';
import HomePage from './pages/HomePage';
import NotificationsPage from './pages/NotificationsPage';
import SettingsPage from './pages/SettingsPage';
import SourcePage from './pages/SourcePage';
import SourcesPage from './pages/SourcesPage';
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

/** ONE flow, by the id in the address, read through the `?repo=` beside it. */
function FlowRoute() {
  const { flowId } = useParams<{ flowId: string }>();
  return <FlowsPage flowId={flowId ? decodeURIComponent(flowId) : undefined} />;
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

/** ONE source of the workspace's context: its scope, its readers, its syncs. */
function ContextSourceRoute() {
  const { sourceId } = useParams<{ sourceId: string }>();
  return <SourcePage sourceId={sourceId ? decodeURIComponent(sourceId) : ''} />;
}

/** The older singular address of a source, now that a source has a page. */
function ContextSourceRedirect() {
  const { sourceId } = useParams<{ sourceId: string }>();
  return <Navigate replace to={`/preview/context/sources/${encodeURIComponent(sourceId ?? '')}`} />;
}

export function PreviewRoutes() {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="agent" element={<AgentPage />} />
      <Route path="agent/:runId" element={<AgentRunRoute />} />
      <Route path="code" element={<CodePage />} />
      <Route path="flows" element={<FlowsPage />} />
      <Route path="flows/:flowId" element={<FlowRoute />} />
      <Route path="context" element={<SourcesPage />} />
      <Route path="context/sources/:sourceId" element={<ContextSourceRoute />} />
      <Route path="context/documents" element={<DocumentsPage />} />
      <Route path="context/conflicts" element={<ConflictsPage />} />
      <Route path="context/conflicts/:conflictId" element={<ContextConflictRoute />} />
      <Route path="context/doc/:docRef" element={<ContextDocRoute />} />
      <Route path="context/source/:sourceId" element={<ContextSourceRedirect />} />
      <Route path="repos/:slug" element={<RepoConsole />} />
      <Route path="repos/:slug/:tab" element={<RepoConsole />} />
      <Route path="repos/:slug/runs/:runId" element={<RepoConsole />} />
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
