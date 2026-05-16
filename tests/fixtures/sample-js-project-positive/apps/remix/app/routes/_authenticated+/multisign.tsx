
declare function toast(opts: { title: string; description?: string; variant?: string }): void;
declare function invalidateQuery(key: string[]): void;

function handleSignError(error: unknown) {
  console.error(error);
  toast({
    title: 'Signing failed',
    description: 'An error occurred while signing the document. Please try again.',
    variant: 'destructive',
  });
  invalidateQuery(['documents', 'signing']);
}
