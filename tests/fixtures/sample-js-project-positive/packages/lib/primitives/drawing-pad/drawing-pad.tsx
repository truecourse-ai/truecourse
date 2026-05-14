
declare function useState<T>(init: T): [T, (v: T) => void];
declare function isBase64Image(v: string): boolean;

type DrawingPadProps = {
  value?: string;
  onChange?: (value: string) => void;
  drawEnabled?: boolean;
  typeEnabled?: boolean;
};

function DrawingPad({ value = '', onChange, drawEnabled = true, typeEnabled = true }: DrawingPadProps) {
  const [drawData, setDrawData] = useState(isBase64Image(value) ? value : '');
  const [typedData, setTypedData] = useState(isBase64Image(value) ? '' : value);

  const [activeTab, setActiveTab] = useState(
    ((): 'draw' | 'type' => {
      if (drawEnabled && drawData) return 'draw';
      if (typeEnabled && typedData) return 'type';
      if (drawEnabled) return 'draw';
      return 'type';
    })(),
  );

  return null;
}
