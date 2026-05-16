
declare const Konva: any;
declare const SkiaImage: any;

type SignatureData = {
  imageAsBase64?: string;
  typedText?: string;
};

function renderSignatureContent(signature: SignatureData | null, container: any) {
  if (signature?.imageAsBase64) {
    const img = new SkiaImage(signature.imageAsBase64) as unknown as HTMLImageElement;
    const signatureImage = new Konva.Image({
      image: img,
      x: 4,
      y: 4,
      width: 100,
      height: 100 * (img.height / img.width),
    });
    container.add(signatureImage);
  } else if (signature?.typedText) {
    const typedSig = new Konva.Text({
      x: 2,
      text: signature.typedText,
      padding: 4,
      fontFamily: 'Caveat',
    });
    container.add(typedSig);
  }
}
