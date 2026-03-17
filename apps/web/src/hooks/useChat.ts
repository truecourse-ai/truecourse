
import { useState, useCallback, useRef } from 'react';
import { streamChat, getConversations, getConversationHistory } from '@/lib/api';
import type { ConversationSummary } from '@/lib/api';

export type DisplayMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
};

export function useChat(repoId: string) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const idCounter = useRef(0);

  const nextId = () => {
    idCounter.current += 1;
    return `msg-${idCounter.current}`;
  };

  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim() || isStreaming) return;

      const userMsg: DisplayMessage = {
        id: nextId(),
        role: 'user',
        content,
        timestamp: new Date(),
      };

      const assistantId = nextId();
      const assistantMsg: DisplayMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      abortRef.current = streamChat(
        repoId,
        content,
        (chunk) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: msg.content + chunk }
                : msg,
            ),
          );
        },
        (convId) => {
          if (convId) conversationIdRef.current = convId;
          setIsStreaming(false);
        },
        (error) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: `Error: ${error.message}` }
                : msg,
            ),
          );
          setIsStreaming(false);
        },
        {
          conversationId: conversationIdRef.current,
        },
      );
    },
    [repoId, isStreaming],
  );

  const explainNode = useCallback(
    (nodeId: string, nodeName: string, nodeType?: string, nodeContext?: Record<string, unknown>) => {
      if (isStreaming) return;

      const kind =
        nodeType === 'method' ? 'function' :
        nodeType === 'module' ? 'module' :
        nodeType === 'layer' ? 'layer' : 'service';
      const content = `Explain the "${nodeName}" ${kind}. What does it do, how does it fit into the architecture, and are there any concerns?`;

      const userMsg: DisplayMessage = {
        id: nextId(),
        role: 'user',
        content,
        timestamp: new Date(),
      };

      const assistantId = nextId();
      const assistantMsg: DisplayMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      abortRef.current = streamChat(
        repoId,
        content,
        (chunk) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: msg.content + chunk }
                : msg,
            ),
          );
        },
        (convId) => {
          if (convId) conversationIdRef.current = convId;
          setIsStreaming(false);
        },
        (error) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: `Error: ${error.message}` }
                : msg,
            ),
          );
          setIsStreaming(false);
        },
        {
          nodeContext,
          conversationId: conversationIdRef.current,
        },
      );
    },
    [repoId, isStreaming],
  );

  const newConversation = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setMessages([]);
    setIsStreaming(false);
    conversationIdRef.current = undefined;
  }, []);

  const fetchConversations = useCallback(async () => {
    try {
      const convs = await getConversations(repoId);
      setConversationList(convs);
    } catch {
      // silently fail
    }
  }, [repoId]);

  const loadConversation = useCallback(
    async (conversationId: string) => {
      if (isStreaming) return;
      setIsLoadingHistory(true);
      try {
        const history = await getConversationHistory(repoId, conversationId);
        conversationIdRef.current = conversationId;
        setMessages(
          history.messages.map((m) => ({
            id: m.id,
            role: m.role as DisplayMessage['role'],
            content: m.content,
            timestamp: new Date(m.createdAt),
          })),
        );
      } catch {
        // silently fail
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [repoId, isStreaming],
  );

  return {
    messages,
    isStreaming,
    isLoadingHistory,
    conversationList,
    sendMessage,
    explainNode,
    newConversation,
    fetchConversations,
    loadConversation,
  };
}
