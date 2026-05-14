// Single file uses 'general' as settings tab id — one usage, not a duplicate
declare function useState<T>(v: T): [T, (v: T) => void];

type SettingsTab = 'general' | 'appearance' | 'advanced';

function CanvasEditorSettingsDialog() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'advanced', label: 'Advanced' },
  ];

  return { activeTab, setActiveTab, tabs };
}
