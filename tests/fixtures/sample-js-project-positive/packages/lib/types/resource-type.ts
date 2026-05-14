
// FP: TemplateKind is an imported enum used in a type alias at the top of the file.
// Imports are hoisted; this is standard TS pattern.
declare const TemplateKind: { PRIVATE: 'PRIVATE'; PUBLIC: 'PUBLIC'; TEAM: 'TEAM' };
type TemplateKindEnum = typeof TemplateKind[keyof typeof TemplateKind];

type TemplateKindIcon = {
  label: string;
  color: string;
  iconName?: string;
};

type TemplateKindTypes = TemplateKindEnum;

const TEMPLATE_KIND_ICONS: Record<TemplateKindTypes, TemplateKindIcon> = {
  PRIVATE: { label: 'Private', color: 'text-blue-600', iconName: 'lock' },
  PUBLIC: { label: 'Public', color: 'text-green-600', iconName: 'globe' },
  TEAM: { label: 'Team', color: 'text-purple-600', iconName: 'building' },
};
