// Remix route alias shim: billing-team.tsx maps URL segment to BillingPage in the org route.
export { TeamBillingPage as default } from '../o.$orgUrl.settings.billing';


// Route shim: templates.$id.edit.tsx maps the team-URL segment to the shared EnvelopeEditorPage.
// The filename is the URL segment for team templates; the export is the actual component. Intentional alias.
export { EnvelopeEditorPage as TemplatesEditor } from '../o.$orgUrl.templates.$id.edit';



// Route shim: billing-team.tsx exports TeamBillingPage as default.
// Filename reflects URL segment; component name reflects its domain — intentional Remix alias pattern.
declare const TeamBillingPage: React.ComponentType;
export default TeamBillingPage;

