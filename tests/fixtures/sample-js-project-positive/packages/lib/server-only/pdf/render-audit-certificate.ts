
declare const Konva: any;
declare const textMutedForeground: string;
declare const textSm: number;
declare const fontMedium: string;

type RenderAuditRowOptions = {
  label: string;
  text: string;
  width: number;
  y?: number;
};

const renderAuditRow = (options: RenderAuditRowOptions) => {
  const { width, y } = options;
  const group = new Konva.Group({ y });

  const labelNode = new Konva.Text({
    x: 0,
    y: 0,
    text: `${options.label}: `,
    fontStyle: fontMedium,
    fontFamily: 'Inter',
    fill: textMutedForeground,
    fontSize: textSm,
  });

  group.add(labelNode);

  const valueNode = new Konva.Text({
    x: labelNode.width(),
    y: 0,
    width: width - labelNode.width(),
    fontFamily: 'Inter',
    text: options.text,
    fill: textMutedForeground,
    wrap: 'char',
    fontSize: textSm,
  });

  group.add(valueNode);
  return group;
};
