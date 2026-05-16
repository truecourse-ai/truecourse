
declare function redirect(url: string): Response;

export function loader() {
  return redirect('/dashboard');
}


// Shape: acd26511235e — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface EmailSettingsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface EmailSettingsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function EmailSettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<EmailSettingsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<EmailSettingsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<EmailSettingsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: adcc92636f0b — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface TeamUpdatePageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface TeamUpdatePageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function TeamUpdatePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<TeamUpdatePageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<TeamUpdatePageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<TeamUpdatePageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b0cc9f6a408d — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface RecipientSelectPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface RecipientSelectPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function RecipientSelectPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<RecipientSelectPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<RecipientSelectPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<RecipientSelectPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b17f7f87b0f3 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface DocumentEditorPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface DocumentEditorPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function DocumentEditorPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<DocumentEditorPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<DocumentEditorPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<DocumentEditorPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b1b9cfd3f231 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface OrganisationDashboardData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface OrganisationDashboardFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function OrganisationDashboard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<OrganisationDashboardData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<OrganisationDashboardFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<OrganisationDashboardData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b3cf2ec0113d — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface ProfileSettingsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface ProfileSettingsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function ProfileSettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<ProfileSettingsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<ProfileSettingsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<ProfileSettingsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b5796c7e38e4 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface NotificationSettingsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface NotificationSettingsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function NotificationSettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<NotificationSettingsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<NotificationSettingsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<NotificationSettingsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b5bc1d3eee4d — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface BillingSettingsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface BillingSettingsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function BillingSettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<BillingSettingsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<BillingSettingsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<BillingSettingsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b5c625b0b314 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface SecuritySettingsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface SecuritySettingsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function SecuritySettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<SecuritySettingsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<SecuritySettingsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<SecuritySettingsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b5d48bf520ae — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface IntegrationSettingsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface IntegrationSettingsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function IntegrationSettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<IntegrationSettingsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<IntegrationSettingsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<IntegrationSettingsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b65edc017282 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface WorkspaceSettingsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface WorkspaceSettingsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function WorkspaceSettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<WorkspaceSettingsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<WorkspaceSettingsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<WorkspaceSettingsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: b6febc0b6d99 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface ApiKeySettingsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface ApiKeySettingsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function ApiKeySettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<ApiKeySettingsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<ApiKeySettingsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<ApiKeySettingsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: bb0778efcec0 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface WebhookSettingsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface WebhookSettingsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function WebhookSettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<WebhookSettingsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<WebhookSettingsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<WebhookSettingsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: bd1a360af575 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface AuditLogPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface AuditLogPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function AuditLogPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<AuditLogPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<AuditLogPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<AuditLogPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: bd758eb60dd7 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface MembersPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface MembersPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function MembersPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<MembersPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<MembersPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<MembersPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: bdff05d02e68 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface InviteMembersPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface InviteMembersPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function InviteMembersPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<InviteMembersPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<InviteMembersPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<InviteMembersPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c1abd3ada191 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface RolesPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface RolesPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function RolesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<RolesPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<RolesPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<RolesPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c1ef2a1dc61e — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface PermissionsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface PermissionsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function PermissionsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<PermissionsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<PermissionsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<PermissionsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c2246d45e1b6 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface SignaturePageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface SignaturePageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function SignaturePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<SignaturePageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<SignaturePageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<SignaturePageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c25f497155b6 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface DocumentListPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface DocumentListPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function DocumentListPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<DocumentListPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<DocumentListPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<DocumentListPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c4b1461feb8a — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface EnvelopeListPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface EnvelopeListPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function EnvelopeListPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<EnvelopeListPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<EnvelopeListPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<EnvelopeListPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c4da77097cfd — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface RecipientListPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface RecipientListPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function RecipientListPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<RecipientListPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<RecipientListPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<RecipientListPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c4f6c3586ce3 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface TemplatePageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface TemplatePageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function TemplatePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<TemplatePageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<TemplatePageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<TemplatePageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c64b11a20d83 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface TemplateEditorPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface TemplateEditorPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function TemplateEditorPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<TemplateEditorPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<TemplateEditorPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<TemplateEditorPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c6f3d0f1ab76 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface SigningPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface SigningPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function SigningPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<SigningPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<SigningPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<SigningPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c8e8bd4d41a8 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface CompletionPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface CompletionPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function CompletionPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<CompletionPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<CompletionPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<CompletionPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: c98d4c5fcef1 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface DashboardPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface DashboardPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<DashboardPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<DashboardPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<DashboardPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: cb8eae8f6ce5 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface AnalyticsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface AnalyticsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<AnalyticsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<AnalyticsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<AnalyticsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: cc7636ffb60e — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface ReportsPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface ReportsPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<ReportsPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<ReportsPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<ReportsPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: cc81362d8ca5 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface ExportPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface ExportPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function ExportPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<ExportPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<ExportPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<ExportPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: cd4576e492aa — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface ImportPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface ImportPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function ImportPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<ImportPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<ImportPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<ImportPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: ce2b7fcb60e0 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface ActivityPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface ActivityPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function ActivityPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<ActivityPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<ActivityPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<ActivityPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: ce926df5d941 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface CommentPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface CommentPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function CommentPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<CommentPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<CommentPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<CommentPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: cf49fad14420 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface AttachmentPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface AttachmentPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function AttachmentPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<AttachmentPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<AttachmentPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<AttachmentPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: cf8e9f664792 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface AnnotationPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface AnnotationPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function AnnotationPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<AnnotationPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<AnnotationPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<AnnotationPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: cfab899fcb8d — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface FieldEditorPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface FieldEditorPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function FieldEditorPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<FieldEditorPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<FieldEditorPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<FieldEditorPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: d03e0377f98a — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface FormBuilderPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface FormBuilderPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function FormBuilderPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<FormBuilderPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<FormBuilderPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<FormBuilderPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: d0596aaff1d3 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface PublicProfilePageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface PublicProfilePageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function PublicProfilePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<PublicProfilePageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<PublicProfilePageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<PublicProfilePageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: d093a31d49a6 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface EmbedPlaygroundPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface EmbedPlaygroundPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function EmbedPlaygroundPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<EmbedPlaygroundPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<EmbedPlaygroundPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<EmbedPlaygroundPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: d099efb2dc71 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface AuthoringPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface AuthoringPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function AuthoringPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<AuthoringPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<AuthoringPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<AuthoringPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


// Shape: d0dfbc364926 — React TSX component that triggers too-many-lines
// due to JSX markup, hooks, and event handlers inflating the line count.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; useEffect: (fn: () => void, deps: unknown[]) => void };
declare function useTranslation(): { t: (k: string) => string };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare function useParams<T extends Record<string, string>>(): T;
declare const apiClient: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T>; put: <T>(url: string, body: unknown) => Promise<T> };

interface ReviewPageData {
  id: string;
  name: string;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    emailDigest: boolean;
    theme: "light" | "dark" | "system";
  };
}

interface ReviewPageFormValues {
  name: string;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  theme: "light" | "dark" | "system";
}

export default function ReviewPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id: string; orgUrl: string }>();

  const [data, setData] = React.useState<ReviewPageData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formValues, setFormValues] = React.useState<ReviewPageFormValues>({
    name: "",
    notificationsEnabled: true,
    emailDigest: false,
    theme: "system",
  });

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const result = await apiClient.get<ReviewPageData>(`/api/${params.orgUrl}/settings/${params.id}`);
        setData(result);
        setFormValues({
          name: result.name,
          notificationsEnabled: result.settings.notificationsEnabled,
          emailDigest: result.settings.emailDigest,
          theme: result.settings.theme,
        });
      } catch (err) {
        toast({
          title: t("error.title"),
          description: t("error.fetch_failed"),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [params.orgUrl, params.id]);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await apiClient.put(`/api/${params.orgUrl}/settings/${params.id}`, {
        name: formValues.name,
        settings: {
          notificationsEnabled: formValues.notificationsEnabled,
          emailDigest: formValues.emailDigest,
          theme: formValues.theme,
        },
      });
      toast({
        title: t("success.title"),
        description: t("success.settings_saved"),
      });
    } catch (err) {
      toast({
        title: t("error.title"),
        description: t("error.save_failed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${params.orgUrl}/settings`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <span className="text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.description")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("field.name")}
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.notifications")}</p>
            <p className="text-muted-foreground text-sm">{t("field.notifications.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.notificationsEnabled}
            onChange={(e) => setFormValues((v) => ({ ...v, notificationsEnabled: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("field.email_digest")}</p>
            <p className="text-muted-foreground text-sm">{t("field.email_digest.description")}</p>
          </div>
          <input
            type="checkbox"
            checked={formValues.emailDigest}
            onChange={(e) => setFormValues((v) => ({ ...v, emailDigest: e.target.checked }))}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border px-4 py-2 text-sm"
            disabled={isSubmitting}
          >
            {t("action.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
