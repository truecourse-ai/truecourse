
// [unknown-catch-variable] catch(err) — console.error(err) safe pass + fixed toast message
declare function inviteTeamMember(opts: { email: string; role: string; teamId: string }): Promise<void>;
declare const teamId: string;
declare const inviteNotify: (opts: { title: string; description: string; variant?: string }) => void;

async function handleMemberInvite(email: string, role: string): Promise<void> {
  try {
    await inviteTeamMember({ email, role, teamId });
    inviteNotify({ title: 'Invitation sent', description: `${email} has been invited to the team.` });
  } catch (err) {
    console.error(err);
    inviteNotify({
      title: 'Invitation failed',
      description: 'We could not send the invitation. Please try again.',
      variant: 'destructive',
    });
  }
}



// FP shape: option is an element from options.forEach; groupKey is a key name on Option type.
// option[groupKey] is a property access on a typed object, not an array index. No out-of-bounds risk.
declare type TSelectOption = { value: string; label: string; category?: string; disabled?: boolean };

function groupSelectOptions<K extends keyof TSelectOption>(
  options: TSelectOption[],
  groupBy: K,
): Map<TSelectOption[K], TSelectOption[]> {
  const grouped = new Map<TSelectOption[K], TSelectOption[]>();

  options.forEach((option) => {
    const groupValue = option[groupBy];
    const existing = grouped.get(groupValue);
    if (existing) {
      existing.push(option);
    } else {
      grouped.set(groupValue, [option]);
    }
  });

  return grouped;
}
