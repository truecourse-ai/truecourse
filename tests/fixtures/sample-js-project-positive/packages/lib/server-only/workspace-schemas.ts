
// z.string().max(30) is a named maximum length constraint for a workspace slug
declare const z: {
  string(): {
    trim(): {
      min(n: number, opts: { message: string }): {
        max(n: number, opts: { message: string }): {
          toLowerCase(): { regex(re: RegExp, msg: string): unknown };
        };
      };
    };
  };
};

const ZWorkspaceSlugSchema = z
  .string()
  .trim()
  .min(3, { message: 'Workspace slug must be at least 3 characters long.' })
  .max(30, { message: 'Workspace slug must not exceed 30 characters.' })
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Slug can only contain letters, numbers, dashes and underscores.');



// z.string().max(50) is a named maximum length constraint for an organization name
declare const z: {
  string(): {
    min(n: number, opts: { message: string }): {
      max(n: number, opts: { message: string }): unknown;
    };
  };
};

const ZOrganisationNameSchema = z
  .string()
  .min(3, { message: 'Minimum 3 characters' })
  .max(50, { message: 'Maximum 50 characters' });
