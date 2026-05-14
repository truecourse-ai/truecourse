// import { useCurrentEnvelopeEditor } from '@documenso/lib/client-only/providers/envelope-editor-provider';
// import { useCurrentOrganisation } from '@documenso/lib/client-only/providers/organisation';
// import { DATE_FORMATS, DEFAULT_DOCUMENT_DATE_FORMAT } from '@documenso/lib/constants/date-formats';
// import { DOCUMENT_DISTRIBUTION_METHODS, DOCUMENT_SIGNATURE_TYPES } from '@documenso/lib/constants/document';
// import { ZEnvelopeExpirationPeriod } from '@documenso/lib/constants/envelope-expiration';
// import { ZEnvelopeReminderSettings } from '@documenso/lib/constants/envelope-reminder';
// import { isValidLanguageCode, SUPPORTED_LANGUAGE_CODES, SUPPORTED_LANGUAGES } from '@documenso/lib/constants/i18n';
// import { DEFAULT_DOCUMENT_TIME_ZONE, TIME_ZONES } from '@documenso/lib/constants/time-zones';
// import { DO_NOT_INVALIDATE_QUERY_ON_MUTATION } from '@documenso/lib/constants/trpc';
// import { AppError } from '@documenso/lib/errors/app-error';
// import { ZDocumentAccessAuthTypesSchema, ZDocumentActionAuthTypesSchema } from '@documenso/lib/types/document-auth';
// import { ZDocumentEmailSettingsSchema } from '@documenso/lib/types/document-email';
import {
// import { extractDocumentAuthMethods } from '@documenso/lib/utils/document-auth';
// import { isValidRedirectUrl } from '@documenso/lib/utils/is-valid-redirect-url';
// import { canAccessTeamDocument, DocumentSignatureType, extractTeamSignatureSettings } from '@documenso/lib/utils/teams';
// import { zEmail } from '@documenso/lib/utils/zod';
// import { trpc } from '@documenso/trpc/react';
// import { DocumentEmailCheckboxes } from '@documenso/ui/components/document/document-email-checkboxes';
import {
import {
// import { DocumentSendEmailMessageHelper } from '@documenso/ui/components/document/document-send-email-message-helper';
// import { DocumentSignatureSettingsTooltip } from '@documenso/ui/components/document/document-signature-settings-tooltip';
import {
// import { ExpirationPeriodPicker } from '@documenso/ui/components/document/expiration-period-picker';
// import { ReminderSettingsPicker } from '@documenso/ui/components/document/reminder-settings-picker';
// import { TemplateTypeSelect, TemplateTypeTooltip } from '@documenso/ui/components/template/template-type-select';
// import { cn } from '@documenso/ui/lib/utils';
// import { Button } from '@documenso/ui/primitives/button';
// import { CardDescription, CardHeader, CardTitle } from '@documenso/ui/primitives/card';
// import { Combobox } from '@documenso/ui/primitives/combobox';
import {
// import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@documenso/ui/primitives/form/form';
// import { Input } from '@documenso/ui/primitives/input';
// import { MultiSelectCombobox } from '@documenso/ui/primitives/multi-select-combobox';
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@documenso/ui/primitives/select';
// import { Textarea } from '@documenso/ui/primitives/textarea';
// import { Tooltip, TooltipContent, TooltipTrigger } from '@documenso/ui/primitives/tooltip';
// import { useToast } from '@documenso/ui/primitives/use-toast';
// import { zodResolver } from '@hookform/resolvers/zod';

// ── snippet ──
                        control={form.control}
                        name="meta.subject"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <Trans>
                                Subject <span className="text-muted-foreground">(Optional)</span>
                              </Trans>
                            </FormLabel>

                            <FormControl>
                              <Input {...field} />
                            </FormControl>

                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="meta.message"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex flex-row items-center">
                              <Trans>
                                Message <span className="text-muted-foreground">(Optional)</span>
                              </Trans>
                              <Tooltip>
                                <TooltipTrigger>
                                  <InfoIcon className="mx-2 h-4 w-4" />
                                </TooltipTrigger>
                                <TooltipContent className="p-4 text-muted-foreground">
                                  <DocumentSendEmailMessageHelper />
                                </TooltipContent>
                              </Tooltip>
                            </FormLabel>

                            <FormControl>
                              <Textarea className="h-16 resize-none bg-background" {...field} />
                            </FormControl>

                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <DocumentEmailCheckboxes
                        value={emailSettings}
                        onChange={(value) => form.setValue('meta.emailSettings', value)}
                      />
                    </>
                  ))
                  .with({ activeTab: 'security' }, () => (
                    <>
                      {organisation.organisationClaim.flags.cfr21 && (
                        <FormField
                          control={form.control}
                          name="globalActionAuth"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex flex-row items-center">
                                <Trans>Recipient action authentication</Trans>
                                <DocumentGlobalAuthActionTooltip />
                              </FormLabel>

                              <FormControl>
                                <DocumentGlobalAuthActionSelect
                                  value={field.value}
                                  disabled={field.disabled}
                                  onValueChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      )}

                      <FormField
                        control={form.control}
                        name="globalAccessAuth"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex flex-row items-center">
                              <Trans>Document access</Trans>
                              <DocumentGlobalAuthAccessTooltip />
                            </FormLabel>

                            <FormControl>
                              <DocumentGlobalAuthAccessSelect
                                value={field.value}
                                disabled={field.disabled}
                                onValueChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {!isEmbedded && (