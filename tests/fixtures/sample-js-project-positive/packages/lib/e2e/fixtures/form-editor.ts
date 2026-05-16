
declare const Page: any;
declare function seedUser(): Promise<{ user: any; team: any }>;
declare function seedBlankForm(user: any, teamId: number, opts?: any): Promise<any>;
declare function apiSignin(opts: any): Promise<void>;

type TFormEditorSurface = {
  root: typeof Page;
  formId: number;
  formType: string;
  userId: string;
};

export const openFormEditor = async (page: typeof Page): Promise<TFormEditorSurface> => {
  const { user, team } = await seedUser();

  const form = await seedBlankForm(user, team.id, {
    internalVersion: 2,
  });

  await apiSignin({
    page,
    email: user.email,
    redirectPath: `/t/${team.url}/forms/${form.id}/edit`,
  });

  return {
    root: page,
    formId: form.id,
    formType: 'DOCUMENT',
    userId: user.id,
  };
};
