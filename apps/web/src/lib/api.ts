import { getServerUrl } from './server-url';

const BASE_URL = getServerUrl();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error');
    throw new ApiError(res.status, body);
  }

  return res.json();
}

export type RepoResponse = {
  id: string;
  name: string;
  path: string;
  lastAnalyzed?: string;
  branches?: string[];
  defaultBranch?: string;
};

export type GraphResponse = {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: {
      label: string;
      description?: string;
      serviceType: string;
      framework?: string;
      fileCount: number;
      layers: string[];
      rootPath: string;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    data: {
      dependencyCount: number;
      dependencyType?: string;
    };
  }>;
};

export type InsightResponse = {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: string;
  targetServiceId?: string | null;
  targetServiceName?: string | null;
  fixPrompt?: string | null;
  createdAt: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

// Repos
export function getRepos(): Promise<RepoResponse[]> {
  return fetchApi<RepoResponse[]>('/api/repos');
}

export function getRepo(id: string): Promise<RepoResponse> {
  return fetchApi<RepoResponse>(`/api/repos/${id}`);
}

export function addRepo(path: string): Promise<RepoResponse> {
  return fetchApi<RepoResponse>('/api/repos', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function deleteRepo(id: string): Promise<void> {
  return fetchApi<void>(`/api/repos/${id}`, { method: 'DELETE' });
}

export function analyzeRepo(id: string, branch?: string): Promise<{ jobId: string }> {
  return fetchApi<{ jobId: string }>(`/api/repos/${id}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ branch }),
  });
}

// Graph
export function getGraph(repoId: string, branch?: string): Promise<GraphResponse> {
  const params = branch ? `?branch=${encodeURIComponent(branch)}` : '';
  return fetchApi<GraphResponse>(`/api/repos/${repoId}/graph${params}`);
}

export function saveGraphPositions(
  repoId: string,
  positions: Record<string, { x: number; y: number }>,
  branch?: string,
): Promise<{ ok: boolean }> {
  const params = branch ? `?branch=${encodeURIComponent(branch)}` : '';
  return fetchApi<{ ok: boolean }>(`/api/repos/${repoId}/graph/positions${params}`, {
    method: 'PUT',
    body: JSON.stringify({ positions }),
  });
}

export function resetGraphPositions(
  repoId: string,
  branch?: string,
): Promise<{ ok: boolean }> {
  const params = branch ? `?branch=${encodeURIComponent(branch)}` : '';
  return fetchApi<{ ok: boolean }>(`/api/repos/${repoId}/graph/positions${params}`, {
    method: 'DELETE',
  });
}

// Insights
export function getInsights(repoId: string): Promise<InsightResponse[]> {
  return fetchApi<InsightResponse[]>(`/api/repos/${repoId}/insights`);
}

// Conversations
export type ConversationSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
};

export type ConversationHistory = {
  conversation: { id: string; repoId: string; createdAt: string; updatedAt: string };
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
  }>;
};

export function getConversations(repoId: string): Promise<ConversationSummary[]> {
  return fetchApi<ConversationSummary[]>(`/api/repos/${repoId}/conversations`);
}

export function getConversationHistory(repoId: string, conversationId: string): Promise<ConversationHistory> {
  return fetchApi<ConversationHistory>(`/api/repos/${repoId}/chat/${conversationId}`);
}

// Chat (SSE streaming)
export function streamChat(
  repoId: string,
  message: string,
  onChunk: (text: string) => void,
  onDone: (conversationId?: string) => void,
  onError: (error: Error) => void,
  options?: { nodeContext?: unknown; conversationId?: string },
): AbortController {
  const controller = new AbortController();
  const url = `${BASE_URL}/api/repos/${repoId}/chat`;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      nodeContext: options?.nodeContext,
      conversationId: options?.conversationId,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new ApiError(res.status, await res.text());
      }
      const convId = res.headers.get('X-Conversation-Id') || undefined;
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              onDone(convId);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                onChunk(parsed.content);
              }
            } catch {
              onChunk(data);
            }
          }
        }
      }
      onDone(convId);
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err);
      }
    });

  return controller;
}
