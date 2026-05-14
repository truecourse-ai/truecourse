// UI toast variant 'destructive' appears once per component — each handles its own error display
declare function toast(opts: { title: string; description?: string; variant: string }): void;

function ItemEditDialog() {
  const handleSave = async (itemId: string, updates: Record<string, unknown>) => {
    try {
      await saveItem(itemId, updates);
      toast({ title: 'Saved', variant: 'success' });
    } catch {
      toast({ title: 'Error saving item', description: 'Please try again.', variant: 'destructive' });
    }
  };
  return { handleSave };
}

declare function saveItem(id: string, updates: Record<string, unknown>): Promise<void>;
