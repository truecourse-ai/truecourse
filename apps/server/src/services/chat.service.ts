import { eq, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { observe } from '@langfuse/tracing';
import { db } from '../config/database.js';
import { conversations, messages } from '../db/schema.js';
import { createLLMProvider, type ChatMessage } from './llm/provider.js';
import { getPrompt } from './llm/prompts.js';

export const sendMessage = observe(async function sendMessage(
  repoId: string,
  conversationId: string | undefined,
  message: string,
  nodeContext?: unknown,
  repoContext?: { architecture?: string; services?: unknown[]; dependencies?: unknown[] }
): Promise<{ conversationId: string; stream: AsyncGenerator<string> }> {
  // Create or get conversation
  let convId = conversationId;

  if (!convId) {
    convId = uuidv4();
    await db.insert(conversations).values({
      id: convId,
      repoId,
    });
  }

  // Save user message
  const userMessageContent = nodeContext
    ? `${message}\n\n[Node Context]: ${JSON.stringify(nodeContext)}`
    : message;

  await db.insert(messages).values({
    id: uuidv4(),
    conversationId: convId,
    role: 'user',
    content: message,
    nodeContext: nodeContext ? (nodeContext as Record<string, unknown>) : null,
  });

  // Fetch conversation history
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(asc(messages.createdAt));

  // Build chat messages
  const chatMessages: ChatMessage[] = history.map((m) => {
    let content = m.content;
    if (m.role === 'user' && m.nodeContext) {
      content = `${m.content}\n\n[Node Context]: ${JSON.stringify(m.nodeContext)}`;
    }
    return {
      role: m.role as ChatMessage['role'],
      content,
    };
  });

  // Build system prompt with repo context
  let systemPrompt = (await getPrompt('chat-system')).text;
  if (repoContext) {
    systemPrompt += `\n\nCurrent project context:\n`;
    if (repoContext.architecture) {
      systemPrompt += `Architecture: ${repoContext.architecture}\n`;
    }
    if (repoContext.services && Array.isArray(repoContext.services)) {
      systemPrompt += `Services: ${JSON.stringify(repoContext.services)}\n`;
    }
    if (repoContext.dependencies && Array.isArray(repoContext.dependencies)) {
      systemPrompt += `Dependencies: ${JSON.stringify(repoContext.dependencies)}\n`;
    }
  }

  // Stream response from LLM
  const provider = createLLMProvider();
  const llmStream = provider.chat(chatMessages, systemPrompt);

  // Wrap the stream to save the complete response when done
  const finalConvId = convId;
  async function* wrappedStream(): AsyncGenerator<string> {
    let fullResponse = '';

    for await (const chunk of llmStream) {
      fullResponse += chunk;
      yield chunk;
    }

    // Save assistant message after streaming completes
    await db.insert(messages).values({
      id: uuidv4(),
      conversationId: finalConvId,
      role: 'assistant',
      content: fullResponse,
    });

    // Update conversation timestamp
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, finalConvId));
  }

  return {
    conversationId: finalConvId,
    stream: wrappedStream(),
  };
}, { name: 'chat' });

export async function getConversationHistory(
  conversationId: string
): Promise<{
  conversation: typeof conversations.$inferSelect;
  messages: (typeof messages.$inferSelect)[];
} | null> {
  const conv = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (conv.length === 0) {
    return null;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  return {
    conversation: conv[0],
    messages: msgs,
  };
}
