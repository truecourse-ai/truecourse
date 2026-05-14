
declare const isBase64Image2: (v: string) => boolean;
declare const DocumentSignatureType2: { UPLOAD: string; DRAW: string; TYPE: string };
declare const useState5: <T>(v: T | (() => T)) => [T, (v: T) => void];
declare const Tabs5: React.FC<{ value: string; onValueChange: (v: string) => void; children?: React.ReactNode }>;
declare const TabsList5: React.FC<{ children?: React.ReactNode }>;
declare const TabsTrigger5: React.FC<{ value: string; children?: React.ReactNode }>;
declare const TabsContent5: React.FC<{ value: string; children?: React.ReactNode }>;
declare const React: { FC: unknown; ReactNode: unknown };

type SignaturePadProps2 = {
  fullName?: string;
  value?: string;
  onChange?: (v: { type: string; value: string }) => void;
  disabled?: boolean;
  typedSignatureEnabled?: boolean;
  uploadSignatureEnabled?: boolean;
  drawSignatureEnabled?: boolean;
  onValidityChange?: (isValid: boolean) => void;
};

export const SignaturePad2 = ({
  fullName,
  value = '',
  onChange,
  disabled = false,
  typedSignatureEnabled = true,
  uploadSignatureEnabled = true,
  drawSignatureEnabled = true,
}: SignaturePadProps2) => {
  const [imageSignature, setImageSignature] = useState5(isBase64Image2(value) ? value : '');
  const [drawSignature, setDrawSignature] = useState5(isBase64Image2(value) ? value : '');
  const [typedSignature, setTypedSignature] = useState5(isBase64Image2(value) ? '' : value);

  const [tab, setTab] = useState5(
    ((): 'draw' | 'text' | 'image' => {
      if (drawSignatureEnabled && drawSignature) return 'draw';
      if (typedSignatureEnabled && typedSignature) return 'text';
      if (uploadSignatureEnabled && imageSignature) return 'image';
      if (drawSignatureEnabled) return 'draw';
      if (typedSignatureEnabled) return 'text';
      if (uploadSignatureEnabled) return 'image';
      throw new Error('No signature enabled');
    })(),
  );

  const onImageSignatureChange = (val: string) => {
    setImageSignature(val);
    onChange?.({ type: DocumentSignatureType2.UPLOAD, value: val });
  };

  const onDrawSignatureChange = (val: string) => {
    setDrawSignature(val);
    onChange?.({ type: DocumentSignatureType2.DRAW, value: val });
  };

  const onTypedSignatureChange = (val: string) => {
    setTypedSignature(val);
    onChange?.({ type: DocumentSignatureType2.TYPE, value: val });
  };

  return (
    <Tabs5 value={tab} onValueChange={(v) => setTab(v as 'draw' | 'text' | 'image')}>
      <TabsList5>
        {drawSignatureEnabled && <TabsTrigger5 value="draw">Draw</TabsTrigger5>}
        {typedSignatureEnabled && <TabsTrigger5 value="text">Type</TabsTrigger5>}
        {uploadSignatureEnabled && <TabsTrigger5 value="image">Upload</TabsTrigger5>}
      </TabsList5>

      {drawSignatureEnabled && (
        <TabsContent5 value="draw">
          <div className="border rounded-md p-4">
            <p className="text-sm text-muted-foreground mb-2">Draw your signature below</p>
            <div
              className="h-32 bg-background border rounded cursor-crosshair"
              onMouseUp={() => onDrawSignatureChange(drawSignature)}
            />
          </div>
        </TabsContent5>
      )}

      {typedSignatureEnabled && (
        <TabsContent5 value="text">
          <div className="border rounded-md p-4">
            <input
              className="w-full border-b bg-transparent text-2xl font-signature"
              value={typedSignature}
              disabled={disabled}
              placeholder={fullName ?? 'Type your signature'}
              onChange={(e) => onTypedSignatureChange(e.target.value)}
            />
          </div>
        </TabsContent5>
      )}

      {uploadSignatureEnabled && (
        <TabsContent5 value="image">
          <div className="border rounded-md p-4">
            <input
              type="file"
              accept="image/*"
              disabled={disabled}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = () => onImageSignatureChange(reader.result as string);
                  reader.readAsDataURL(file);
                }
              }}
            />
          </div>
        </TabsContent5>
      )}
    </Tabs5>
  );
};
