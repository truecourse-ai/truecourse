
// Fire-and-forget migrations at module top-level
declare function migrateStaleSessionTokens(): Promise<void>;
declare function migrateOrphanedWorkspaceRecords(): Promise<void>;

void migrateStaleSessionTokens();
void migrateOrphanedWorkspaceRecords();



// Fire-and-forget promise chain cleanup in finally block
declare const renderWorker: { destroy(): Promise<void> };
declare const pdfTask: { destroy(): Promise<void> };

const cleanupWorkers = () => {
  try {
    // …processing…
  } finally {
    void renderWorker.destroy().catch((e) => console.error(e));
    void pdfTask.destroy().catch((e) => console.error(e));
  }
};



// Fire-and-forget i18n activation via promise chain void discard
declare function activateLocale(lang: string): Promise<void>;
declare const selectedLanguage: string;
declare const defaultLang: string;
declare function setReady(v: boolean): void;

if (selectedLanguage && selectedLanguage !== defaultLang) {
  void activateLocale(selectedLanguage).finally(() => {
    setReady(true);
  });
} else {
  setReady(true);
}
