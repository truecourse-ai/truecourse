
declare function useLoaderData<T>(): T;
declare const Link: (props: { to: string; className?: string; children?: unknown }) => unknown;
declare const ChevronLeft: unknown;
declare const DocumentTypeBadge: (props: { className?: string; type: string }) => unknown;
declare const DirectLinkBadge: (props: { className?: string; token: string; enabled: boolean }) => unknown;
declare const AttachmentsPopover: (props: { templateId: string }) => unknown;
declare const DirectLinkDialog: (props: { templateId: string }) => unknown;
declare const EditorPanel: (props: { template: unknown; rootPath: string }) => unknown;

type TemplateLoaderData = {
  template: {
    id: string;
    title: string;
    type: string;
    templateId: string;
    directLink?: { token: string; enabled: boolean } | null;
  };
  templateRootPath: string;
};

export default function TemplateEditPage() {
  const { template, templateRootPath } = useLoaderData<TemplateLoaderData>();

  return (
    <div className="mx-auto -mt-4 max-w-screen-xl px-4 md:px-8">
      <div className="flex flex-col justify-between sm:flex-row">
        <div>
          <Link
            to={`${templateRootPath}/${template.templateId}`}
            className="flex items-center text-brand-700 hover:opacity-80"
          >
            {ChevronLeft as any}
            <span>Template</span>
          </Link>

          <h1
            className="mt-4 block max-w-[20rem] truncate font-semibold text-2xl md:max-w-[30rem] md:text-3xl"
            title={template.title}
          >
            {template.title}
          </h1>

          <div className="mt-2.5 flex items-center">
            {DocumentTypeBadge({ className: 'text-muted-foreground', type: template.type })}

            {template.directLink?.token &&
              DirectLinkBadge({
                className: 'ml-4',
                token: template.directLink.token,
                enabled: template.directLink.enabled,
              })}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 sm:mt-0 sm:self-end">
          {AttachmentsPopover({ templateId: template.templateId })}
          {DirectLinkDialog({ templateId: template.id })}
        </div>
      </div>

      <div className="mt-6">
        {EditorPanel({ template, rootPath: templateRootPath })}
      </div>
    </div>
  );
}
