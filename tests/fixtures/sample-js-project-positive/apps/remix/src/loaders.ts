
// Wave-M33: getItemById with nested discriminated union id — 'templateId' literal is valid
declare function getItemById(opts: {
  id: { type: 'templateId'; id: number } | { type: 'documentId'; id: number };
  type: 'TEMPLATE' | 'DOCUMENT';
  userId: number;
  teamId: number;
}): Promise<{ id: string; title: string } | null>;

declare const templateId: number;
declare const userId: number;
declare const teamId: number;

const template = await getItemById({
  id: { type: 'templateId', id: templateId },
  type: 'TEMPLATE',
  userId,
  teamId,
});


// missing-return-type FP: Remix loader export; return type inferred from data() call — framework-conventional export
declare function getSessionForRequest(req: unknown): Promise<{ isAuthenticated: boolean; userId?: string }>;
declare function getWorkspaceSettings(): Promise<Array<{ id: string; value: unknown }>>;
declare const ANNOUNCEMENT_BANNER_ID: string;
declare function data(payload: unknown): unknown;

export async function layoutLoader({ request }: { request: unknown }) {
  const [session, announcementBanner] = await Promise.all([
    getSessionForRequest(request),
    getWorkspaceSettings().then((settings) =>
      settings.find((s) => s.id === ANNOUNCEMENT_BANNER_ID),
    ),
  ]);

  return data({ session, announcementBanner });
}

