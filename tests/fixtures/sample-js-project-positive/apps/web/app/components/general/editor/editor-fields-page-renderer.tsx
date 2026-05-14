
declare function setSelectedItems(items: any[]): void;
declare const transformer: { nodes: () => any[]; };

function handleFieldClick(
  e: any,
  selectionRect: { visible: () => boolean; width: () => number; height: () => number },
  stage: { current: any },
) {
  if (selectionRect.visible() && selectionRect.width() > 0 && selectionRect.height() > 0) {
    return;
  }

  if (e.target === stage.current) {
    setSelectedItems([]);
    return;
  }

  if (!e.target.hasName('field-group') || e.target.draggable() === false) {
    return;
  }

  const metaPressed = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
  const isSelected = transformer.nodes().indexOf(e.target) >= 0;

  if (!metaPressed && !isSelected) {
    setSelectedItems([e.target]);
  } else if (metaPressed && isSelected) {
    const nodes = transformer.nodes().slice();
    nodes.splice(nodes.indexOf(e.target), 1);
    setSelectedItems(nodes);
  } else if (metaPressed && !isSelected) {
    setSelectedItems(transformer.nodes().concat([e.target]));
  }
}
