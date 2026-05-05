/**
 * MSW-style mock handlers. The masked placeholder values are intentional —
 * they stand in for real credentials that should never appear in fixtures.
 */

export const mockOrganisation = {
  id: 'org_1',
  name: 'Acme',
  llm_api_key: '**********',
  webhook_secret: '<redacted>',
};

export const mockUser = {
  id: 'user_1',
  email: 'jane@acme.test',
  api_key: 'placeholder',
};
