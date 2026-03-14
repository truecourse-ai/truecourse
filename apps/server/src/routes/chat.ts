import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db } from '../config/database.js';
import { repos, analyses, services, serviceDependencies, conversations, messages } from '../db/schema.js';
import { ChatMessageSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { sendMessage, getConversationHistory } from '../services/chat.service.js';

const router: Router = Router();

// GET /api/repos/:id/conversations - List conversations for a repo
router.get(
  '/:id/conversations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // Get conversations with their first user message as preview
      const convs = await db
        .select({
          id: conversations.id,
          createdAt: conversations.createdAt,
          updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .where(eq(conversations.repoId, id))
        .orderBy(desc(conversations.updatedAt));

      // Get first user message for each conversation as preview
      const result = await Promise.all(
        convs.map(async (conv) => {
          const [firstMsg] = await db
            .select({ content: messages.content })
            .from(messages)
            .where(eq(messages.conversationId, conv.id))
            .orderBy(messages.createdAt)
            .limit(1);

          return {
            ...conv,
            preview: firstMsg?.content?.slice(0, 100) || 'Empty conversation',
          };
        })
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/repos/:id/chat - Send chat message (SSE streaming)
router.post(
  '/:id/chat',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const parsed = ChatMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        throw createAppError('Invalid request body: message is required', 400);
      }

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // Build repo context from latest analysis
      let repoContext: {
        architecture?: string;
        services?: unknown[];
        dependencies?: unknown[];
      } = {};

      const latestAnalysis = await db
        .select()
        .from(analyses)
        .where(eq(analyses.repoId, id))
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      if (latestAnalysis.length > 0) {
        const analysis = latestAnalysis[0];

        const analysisServices = await db
          .select()
          .from(services)
          .where(eq(services.analysisId, analysis.id));

        const analysisDeps = await db
          .select()
          .from(serviceDependencies)
          .where(eq(serviceDependencies.analysisId, analysis.id));

        const serviceNameMap = new Map(
          analysisServices.map((s) => [s.id, s.name])
        );

        repoContext = {
          architecture: analysis.architecture,
          services: analysisServices.map((s) => ({
            name: s.name,
            type: s.type,
            framework: s.framework,
            fileCount: s.fileCount,
          })),
          dependencies: analysisDeps.map((d) => ({
            source: serviceNameMap.get(d.sourceServiceId) || 'unknown',
            target: serviceNameMap.get(d.targetServiceId) || 'unknown',
            count: d.dependencyCount,
            type: d.dependencyType,
          })),
        };
      }

      const { conversationId, stream } = await sendMessage(
        id,
        parsed.data.conversationId,
        parsed.data.message,
        parsed.data.nodeContext,
        repoContext
      );

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Conversation-Id', conversationId);
      res.flushHeaders();

      // Stream response chunks as SSE events
      try {
        for await (const chunk of stream) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        }

        res.write(
          `data: ${JSON.stringify({ type: 'done', conversationId })}\n\n`
        );
      } catch (error) {
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Stream error',
          })}\n\n`
        );
      }

      res.end();
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/chat/:conversationId - Get conversation history
router.get(
  '/:id/chat/:conversationId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const conversationId = req.params.conversationId as string;

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      const result = await getConversationHistory(conversationId);

      if (!result) {
        throw createAppError('Conversation not found', 404);
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
