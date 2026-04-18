"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/20 opacity-100 transition-opacity duration-200 ease-out data-closed:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  title,
  description,
  ...props
}: DialogPrimitive.Popup.Props & {
  side?: "right" | "left"
  showCloseButton?: boolean
  title?: React.ReactNode
  description?: React.ReactNode
}) {
  const sideClasses =
    side === "right"
      ? "right-0 top-0 h-full border-l translate-x-0 data-closed:translate-x-full data-starting-style:translate-x-full"
      : "left-0 top-0 h-full border-r translate-x-0 data-closed:-translate-x-full data-starting-style:-translate-x-full"

  return (
    <DialogPrimitive.Portal data-slot="sheet-portal">
      <SheetOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex w-[560px] max-w-[92vw] flex-col bg-card text-sm shadow-xl ring-1 ring-foreground/10 transition-transform duration-200 ease-out outline-none",
          sideClasses,
          className,
        )}
        {...props}
      >
        {(title || showCloseButton) && (
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            {title && (
              <DialogPrimitive.Title className="flex-1 text-sm font-semibold">
                {title}
              </DialogPrimitive.Title>
            )}
            {description && (
              <DialogPrimitive.Description className="sr-only">
                {description}
              </DialogPrimitive.Description>
            )}
            {showCloseButton && (
              <DialogPrimitive.Close
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent }
