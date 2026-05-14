
declare function getUserById(userId: string): Promise<{ id: string; name: string; email: string; role: string } | null>;
declare function getUserActivity(userId: string): Promise<{ id: string; action: string; createdAt: Date }[]>;
declare const Response: { new(body: string, init: { status: number }): unknown };

export async function loader({ params }: { params: { id: string } }) {
  const { id } = params;

  const [user, activity] = await Promise.all([
    getUserById(id),
    getUserActivity(id),
  ]);

  if (!user) {
    throw new (Response as any)('Not Found', { status: 404 });
  }

  return { user, activity };
}

export default function UserDetailPage() {
  return null;
}
