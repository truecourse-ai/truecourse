
declare function useState<T>(initial: T): [T, React.Dispatch<React.SetStateAction<T>>];

type CssVars = Record<string, string>;

function ThemePlayground() {
  const [cssVars, setCssVars] = useState<CssVars>({
    '--color-primary': '#3b82f6',
    '--color-secondary': '#6b7280',
    '--border-radius': '0.5rem',
  });

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.name;
    setCssVars((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.name;
    setCssVars((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const clearVar = (key: string) => {
    setCssVars((prev) => ({ ...prev, [key]: '' }));
  };

  return { cssVars, handleColorChange, handleTextChange, clearVar };
}
