

// --- missing-destructuring shape: radix-namespace-re-export-alias-pattern ---
declare const AccordionPrimitive: {
  Root: unknown;
  Item: unknown;
  Header: unknown;
  Trigger: unknown;
  Content: unknown;
};

const Accordion = AccordionPrimitive.Root;
const AccordionItem = AccordionPrimitive.Item;
const AccordionHeader = AccordionPrimitive.Header;
const AccordionTrigger = AccordionPrimitive.Trigger;
const AccordionContent = AccordionPrimitive.Content;

export { Accordion, AccordionItem, AccordionHeader, AccordionTrigger, AccordionContent };
