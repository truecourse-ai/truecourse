/**
 * The React half of {@link ./posthog}: one component, mounted once at the app
 * root inside the router and the auth provider.
 *
 * It starts the client, turns the router's address changes into pageviews, and
 * names the person once the session probe answers. It renders nothing, and it
 * sits OUTSIDE the auth gate so a session still loading or refused is still a
 * visit that happened.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { toDashboardUser } from '@/dashboard/shell/use-dashboard-user';
import { identifyUser, initPostHog, trackPageview } from './posthog';

export function Analytics() {
  const { status, user } = useAuth();
  const { pathname, search } = useLocation();
  // The load itself is captured by `posthog.init`, so the address the app
  // started on is already counted: only a change is a pageview from here.
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    initPostHog();
  }, []);

  useEffect(() => {
    const path = `${pathname}${search}`;
    if (lastPath.current === path) return;
    const first = lastPath.current === null;
    lastPath.current = path;
    if (!first) trackPageview(path);
  }, [pathname, search]);

  useEffect(() => {
    if (status !== 'authed' || !user) return;
    identifyUser({
      id: user.id,
      email: user.email,
      name: toDashboardUser(user).name,
      workspaceId: user.organizationId,
      workspaceName: user.organizationName,
    });
  }, [status, user]);

  return null;
}
