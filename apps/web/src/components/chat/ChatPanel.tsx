'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Plus, Clock, ArrowLeft } from 'lucide-react';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { useChat, type DisplayMessage } from '@/hooks/useChat';

type ChatPanelProps = {
  repoId: string;
  selectedService?: string | null;
  explainRequest?: { nodeId: string; nodeName: string; nodeType?: string } | null;
  onExplainHandled?: () => void;
};

export function ChatPanel({ repoId, explainRequest, onExplainHandled }: ChatPanelProps) {
  const {
    messages,
    isStreaming,
    isLoadingHistory,
    conversationList,
    sendMessage,
    explainNode,
    newConversation,
    fetchConversations,
    loadConversation,
  } = useChat(repoId);
  const lastExplainRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Auto-scroll to bottom during streaming and new messages
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastMessage?.content, messages.length]);

  // Handle explain requests
  useEffect(() => {
    if (explainRequest && explainRequest.nodeId !== lastExplainRef.current) {
      lastExplainRef.current = explainRequest.nodeId;
      explainNode(explainRequest.nodeId, explainRequest.nodeName, explainRequest.nodeType);
      onExplainHandled?.();
    }
  }, [explainRequest, explainNode, onExplainHandled]);

  const handleSend = (content: string) => {
    sendMessage(content);
  };

  const handleShowHistory = () => {
    fetchConversations();
    setShowHistory(true);
  };

  const handleSelectConversation = (id: string) => {
    loadConversation(id);
    setShowHistory(false);
  };

  const handleNewConversation = () => {
    newConversation();
    setShowHistory(false);
  };

  // History list view
  if (showHistory) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            onClick={() => setShowHistory(false)}
            className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium text-foreground">Conversations</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversationList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No conversations yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {conversationList.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className="w-full px-3 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <p className="truncate text-sm text-foreground">{conv.preview}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {new Date(conv.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-1 border-b border-border px-2 py-1.5">
        <button
          onClick={handleNewConversation}
          className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="New conversation"
          title="New conversation"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          onClick={handleShowHistory}
          className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Conversation history"
          title="Conversation history"
        >
          <Clock className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-3">
          {isLoadingHistory ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageCircle className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                Architecture Chat
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ask questions about your codebase architecture
              </p>
            </div>
          ) : (
            messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
          )}
          {isStreaming && (() => {
            const lastAssistant = [...messages].reverse().find((m: DisplayMessage) => m.role === 'assistant');
            const hasContent = !!lastAssistant?.content;
            return (
              <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                {hasContent ? (
                  <span className="inline-flex gap-0.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                  </span>
                ) : (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Thinking...
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
