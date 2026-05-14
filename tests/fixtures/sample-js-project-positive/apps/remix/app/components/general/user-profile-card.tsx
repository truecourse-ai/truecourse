declare const Avatar: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const AvatarImage: (props: { src?: string; alt?: string }) => JSX.Element;
declare const AvatarFallback: (props: { children: React.ReactNode }) => JSX.Element;
declare const Badge: (props: { children: React.ReactNode; variant?: string }) => JSX.Element;
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; variant?: string; size?: string; className?: string }) => JSX.Element;
declare const Separator: () => JSX.Element;
declare const getInitials: (name: string) => string;
declare const formatDate: (d: Date) => string;

type UserProfileCardProps = {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    role: string;
    joinedAt: Date;
    isVerified: boolean;
  };
  onEdit?: () => void;
  onViewActivity?: () => void;
};

export function UserProfileCard({ user, onEdit, onViewActivity }: UserProfileCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <Avatar className="h-14 w-14">
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
          <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold">{user.name}</h3>
            {user.isVerified && (
              <Badge variant="default">Verified</Badge>
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          <p className="text-xs text-muted-foreground">Role: {user.role}</p>
        </div>
      </div>
      <Separator />
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Member since</span>
          <span>{formatDate(user.joinedAt)}</span>
        </div>
      </div>
      <div className="flex gap-2">
        {onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit} className="flex-1">
            Edit profile
          </Button>
        )}
        {onViewActivity && (
          <Button variant="ghost" size="sm" onClick={onViewActivity} className="flex-1">
            View activity
          </Button>
        )}
      </div>
    </div>
  );
}
