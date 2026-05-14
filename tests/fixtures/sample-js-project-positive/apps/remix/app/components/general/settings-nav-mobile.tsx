// Desktop and mobile nav each check the same pathname prefix — responsive counterparts mirror each other
declare const window: { location: { pathname: string } };

function SettingsNavDesktop() {
  const isProfileActive = window.location.pathname.startsWith('/settings/profile');
  const isSecurityActive = window.location.pathname.startsWith('/settings/security');
  return { isProfileActive, isSecurityActive };
}

function SettingsNavMobile() {
  const isProfileActive = window.location.pathname.startsWith('/settings/profile');
  const isSecurityActive = window.location.pathname.startsWith('/settings/security');
  return { isProfileActive, isSecurityActive };
}
