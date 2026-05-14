
declare function useEffect(fn: () => void | (() => void), deps: any[]): void;
declare function navigate(path: string, opts?: any): void;
declare const EnvelopeType: { FORM: string; SURVEY: string };
declare function formatFormsPath(teamUrl: string): string;
declare function formatSurveysPath(teamUrl: string): string;

function useFormEditorRedirect(
  form: any,
  team: { id: number; url: string },
) {
  useEffect(() => {
    if (!form) return;

    const pathPrefix =
      form.type === EnvelopeType.FORM ? formatFormsPath(team.url) : formatSurveysPath(team.url);

    if (form.teamId !== team.id) {
      void navigate(pathPrefix, { replace: true });
    } else if (form.internalVersion !== 2) {
      void navigate(`${pathPrefix}/${form.id}/legacy_editor`, { replace: true });
    }
  }, [form, team]);
}
