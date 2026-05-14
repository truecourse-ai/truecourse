
// FP: Object.keys(derived) as (keyof typeof derived)[] — standard narrowing from string[].
type OrgSettings = {
  brandColor: string | null;
  logoUrl: string | null;
  customDomain: string | null;
  ssoEnabled: boolean | null;
};

type TeamSettings = OrgSettings;

function mergeTeamSettings(orgSettings: OrgSettings, teamSettings: TeamSettings): OrgSettings {
  const derived: OrgSettings = { ...orgSettings };

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  for (const key of Object.keys(derived) as (keyof typeof derived)[]) {
    const teamValue = teamSettings[key];
    if (teamValue !== null) {
      // @ts-expect-error dynamic key assignment
      derived[key] = teamValue;
    }
  }

  return derived;
}


// FP: alias inside declare global { namespace PrismaJson } is required by prisma-json-types-generator
type ReportColumnConfigBase_8a63d8 = { key: string; label?: string; width?: number };
type ReportColumnConfig_8a63d8 = ReportColumnConfigBase_8a63d8;

