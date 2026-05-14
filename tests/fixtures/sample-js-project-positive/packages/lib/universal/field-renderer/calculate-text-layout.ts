
declare const Konva: any;

type TextLayoutParams = {
  text: string;
  fontSize: number;
  fontFamily: string;
  baseWidth: number;
  baseHeight: number;
};

function calculateTextLayout({ text, fontSize, fontFamily, baseWidth, baseHeight }: TextLayoutParams) {
  const inline = new Konva.Text({ text, fontSize, fontFamily });
  const exceedsWidth = inline.width() > baseWidth;
  const lineH = inline.height();
  inline.destroy();

  const wrapped = new Konva.Text({
    text,
    fontSize,
    fontFamily,
    width: baseWidth,
    wrap: 'word',
  });
  const exceedsHeight = wrapped.height() > baseHeight;
  wrapped.destroy();

  return { exceedsWidth, exceedsHeight, hasMultiLineRoom: baseHeight >= lineH * 2 };
}
