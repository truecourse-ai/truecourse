declare const useLoaderData: () => { branding: { primaryColor?: string; logoUrl?: string; companyName?: string; supportEmail?: string } };
declare const BrandingPreferencesForm: (props: { initialValues: unknown; onSaved?: () => void }) => JSX.Element;
declare const Card: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CardContent: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CardHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const CardTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const CardDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const Separator: () => JSX.Element;

export default function TeamBrandingSettingsPage() {
  const { branding } = useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Branding</h1>
        <p className="text-sm text-muted-foreground">
          Customize the appearance of documents and emails sent by your team.
        </p>
      </div>
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle>Brand identity</CardTitle>
          <CardDescription>
            These settings apply to all documents and notifications your team sends.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingPreferencesForm initialValues={branding} />
        </CardContent>
      </Card>
    </div>
  );
}
