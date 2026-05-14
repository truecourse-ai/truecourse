
// Static array literal of route config objects ending with .filter() — not dynamic data — FP shape c657909602f0
declare function IS_BILLING_ENABLED(): boolean;
declare const currentOrg: { url: string };

function SettingsLayout() {
  const isBillingEnabled = IS_BILLING_ENABLED();

  const settingRoutes = [
    {
      path: `/o/${currentOrg.url}/settings/general`,
      label: 'General',
    },
    {
      path: `/o/${currentOrg.url}/settings/preferences`,
      label: 'Preferences',
    },
    {
      path: `/o/${currentOrg.url}/settings/billing`,
      label: 'Billing',
      hidden: !isBillingEnabled,
    },
    {
      path: `/o/${currentOrg.url}/settings/members`,
      label: 'Members',
    },
  ].filter((route) => !route.hidden);

  return null;
}
