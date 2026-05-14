declare function DropdownMenuItem(props: any): any;
declare function WebhookEditDialog(props: any): any;
declare function WebhookDeleteDialog(props: any): any;
declare const webhookId: string;

const WebhookDropdown = () => {
  return (
    <div>
      <WebhookEditDialog
        webhookId={webhookId}
        trigger={
          <DropdownMenuItem asChild onSelect={(e: any) => e.preventDefault()}>
            <div>Edit</div>
          </DropdownMenuItem>
        }
      />
      <WebhookDeleteDialog webhookId={webhookId}>
        <DropdownMenuItem asChild onSelect={(e: any) => e.preventDefault()}>
          <div>Delete</div>
        </DropdownMenuItem>
      </WebhookDeleteDialog>
    </div>
  );
};
