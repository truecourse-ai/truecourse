
import { useState } from 'react';
import { FolderOpen, Plus, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type RepoSelectorProps = {
  onAdd: (path: string) => Promise<unknown>;
};

export function RepoSelector({ onAdd }: RepoSelectorProps) {
  const [path, setPath] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;

    setIsAdding(true);
    try {
      await onAdd(path.trim());
      setPath('');
    } catch {
      // Error is handled by the parent via useRepo hook state
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <FolderOpen className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Paste repository path..."
            className="pl-10"
          />
        </div>
        <Button
          type="submit"
          disabled={isAdding || !path.trim()}
        >
          {isAdding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add Repository
        </Button>
      </div>
    </form>
  );
}
