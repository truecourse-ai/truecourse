'use client';

import { Info } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { DisplayMessage } from '@/hooks/useChat';

type ChatMessageProps = {
  message: DisplayMessage;
};

export function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === 'system') {
    return (
      <div className="flex items-center justify-center gap-1.5 py-2">
        <Info className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }

  const isUser = message.role === 'user';

  // Don't render empty assistant messages (still streaming)
  if (!isUser && !message.content) {
    return null;
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-sm text-foreground">
      <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_pre]:text-xs [&_code]:text-xs">
        <ReactMarkdown>{message.content}</ReactMarkdown>
      </div>
    </div>
  );
}
