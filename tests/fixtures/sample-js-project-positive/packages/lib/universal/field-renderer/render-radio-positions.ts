
// Konva Group.find(selector) returns Node array, never undefined — no null check needed
interface KonvaGroup {
  find(selector: string): KonvaNode[];
}
interface KonvaNode {
  x(): number;
  y(): number;
  radius(r?: number): number;
}

declare const radioFieldGroup: KonvaGroup;

function updateRadioCirclePositions(): void {
  const radioCircles = radioFieldGroup.find('.radio-circle');
  radioCircles.forEach((circle, index) => {
    circle.x(index * 24);
    circle.y(0);
  });
}
