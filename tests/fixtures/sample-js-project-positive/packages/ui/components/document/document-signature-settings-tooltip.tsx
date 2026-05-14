
declare const Tooltip40: React.ComponentType<{ children: React.ReactNode }>;
declare const TooltipTrigger40: React.ComponentType<{ type?: string; children: React.ReactNode }>;
declare const TooltipContent40: React.ComponentType<{ className?: string; children: React.ReactNode }>;
declare const InfoIcon40: React.ComponentType<{ className?: string }>;

export const DocumentAttachmentSettingsTooltip40 = () => {
  return (
    <Tooltip40>
      <TooltipTrigger40 type="button">
        <InfoIcon40 className="mx-2 h-4 w-4" />
      </TooltipTrigger40>

      <TooltipContent40 className="max-w-md space-y-2 p-4 text-foreground">
        <h2>
          <strong>Attachment settings</strong>
        </h2>

        <p>Configure how recipients are allowed to attach files to this document.</p>

        <ul className="ml-3.5 list-outside list-disc space-y-0.5 py-2">
          <li>
            <strong>Required</strong>
            {' - '}
            Recipients must attach a file before they can sign.
          </li>
          <li>
            <strong>Optional</strong>
            {' - '}
            Recipients may attach a file but are not required to.
          </li>
          <li>
            <strong>Disabled</strong>
            {' - '}
            Recipients cannot attach files to this document.
          </li>
          <li>
            <strong>File size limit</strong>
            {' - '}
            Maximum file size allowed per attachment (in MB).
          </li>
        </ul>
      </TooltipContent40>
    </Tooltip40>
  );
};
