declare function DropdownMenuItem(props: any): any;
declare function EmailUpdateDialog(props: any): any;
declare function EmailDeleteDialog(props: any): any;
declare const teamId: string;

const TeamEmailDropdown = () => {
  return (
    <div>
      <EmailUpdateDialog
        teamId={teamId}
        trigger={
          <DropdownMenuItem onSelect={(e: any) => e.preventDefault()}>
            Edit
          </DropdownMenuItem>
        }
      />
      <EmailDeleteDialog teamId={teamId}>
        <DropdownMenuItem onSelect={(e: any) => e.preventDefault()}>
          Remove
        </DropdownMenuItem>
      </EmailDeleteDialog>
    </div>
  );
};
