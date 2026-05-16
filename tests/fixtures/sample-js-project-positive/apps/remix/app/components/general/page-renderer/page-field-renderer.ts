
// Paired split calls: context string on one console.error, error object on the next
function renderPageFields(pageFields: PageField[]): void {
  for (const field of pageFields) {
    try {
      renderFieldOnCanvas(field);
    } catch (err) {
      console.error('Unable to render one or more fields belonging to other recipients.');
      console.error(err);
    }
  }
}

interface PageField { id: string; type: string; x: number; y: number; }
declare function renderFieldOnCanvas(field: PageField): void;
