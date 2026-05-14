
// Seed script progress output — console.log is the correct output
// mechanism for dev-only tooling scripts.
declare const MEMBER_COUNT: number;
declare function seedOrganisation(opts: { memberCount: number }): Promise<{ owner: { email: string }; team: { url: string; id: string }; org: { id: string } }>;

const seedLargeOrganisation = async () => {
  console.log(`[SEEDING]: Creating organisation with ${MEMBER_COUNT} members...`);

  const { owner, team, org } = await seedOrganisation({ memberCount: MEMBER_COUNT });

  console.log(`[SEEDING]: Done.`);
  console.log(`  Owner email:  ${owner.email}`);
  console.log(`  Team URL:     ${team.url} (id ${team.id})`);
  console.log(`  Org ID:       ${org.id}`);
};

seedLargeOrganisation().catch(console.error);



// Seed script step output — dev-only tooling where console.log is appropriate.
declare const membersToAttach: Array<{ id: string }>;
declare function attachTeamMembers(opts: { members: Array<{ id: string }> }): Promise<void>;

console.log(`[SEEDING]: Attaching ${membersToAttach.length} members to the team role group...`);
await attachTeamMembers({ members: membersToAttach });



// Seed script completion message — dev-only tooling where console.log is appropriate.
console.log(`[SEEDING]: Seeding complete.`);



// Seed script summary — prints owner credentials for dev setup. console.log
// is appropriate in dev-only seed tooling.
declare const owner: { email: string };
console.log(`  Owner email:    ${owner.email}`);
console.log(`  Owner password: password`);



// Seed script summary output line — dev-only seed tooling where console.log
// is appropriate for reporting seeded data summaries.
declare const org: { url: string; id: string };
console.log(`  Organisation:   ${org.url} (id ${org.id})`);
