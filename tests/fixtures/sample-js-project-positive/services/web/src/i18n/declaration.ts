/**
 * Generated i18n key declaration. The values are literal strings (not
 * computed expressions), so the `computed-enum-value` rule must skip
 * them. Tree-sitter shape:
 *   enum_assignment → [property_identifier, string]
 * The rule was reading namedChildren[0] (the LHS identifier) and treating
 * it as the value, causing every string-enum member to fire.
 *
 * Mirrors OpenHands' frontend/src/i18n/declaration.ts.
 */

export enum I18nKey {
  COMMON$LOADING = 'COMMON$LOADING',
  COMMON$SAVING = 'COMMON$SAVING',
  COMMON$SAVE = 'COMMON$SAVE',
  AZURE_DEVOPS$CONNECT_ACCOUNT = 'AZURE_DEVOPS$CONNECT_ACCOUNT',
  GIT$AZURE_DEVOPS_TOKEN = 'GIT$AZURE_DEVOPS_TOKEN',
}

export enum RecipientStatus {
  COMPLETED = 'completed',
  OPENED = 'opened',
  WAITING = 'waiting',
  UNSIGNED = 'unsigned',
  REJECTED = 'rejected',
}
