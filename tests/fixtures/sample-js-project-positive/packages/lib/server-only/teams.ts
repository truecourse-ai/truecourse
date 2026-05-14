
declare const projectGroup: { projectMembers: Array<{ projectAccount: { id: string }; role: string }> };
declare const accountId: string;

function findProjectMember() {
  const member = projectGroup.projectMembers.find(
    (pm) => pm.projectAccount.id === accountId,
  );
  return member;
}
