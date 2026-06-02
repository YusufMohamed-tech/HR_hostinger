"use client";

import React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ConfirmActionButtonProps = Omit<ButtonProps, "onClick"> & {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

function ConfirmActionButton({
  title,
  description,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  destructive = false,
  onConfirm,
  children,
  ...buttonProps
}: ConfirmActionButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    await onConfirm();
    setSubmitting(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button {...buttonProps} />}>{children}</DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-[420px] border border-brand/15 shadow-xl">
        <DialogHeader className="text-right">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle className="text-lg text-gray-950">{title}</DialogTitle>
          <DialogDescription className="leading-6 text-gray-600">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-start">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            {cancelLabel}
          </Button>
          <Button
            className={
              destructive
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-brand text-white hover:bg-brand-dark"
            }
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "جاري التنفيذ..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessageDialog({
  open,
  onOpenChange,
  title = "تنبيه",
  description,
  actionLabel = "حسنًا",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description: string;
  actionLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-[420px] border border-brand/15 shadow-xl">
        <DialogHeader className="text-right">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
            <Info className="h-5 w-5" />
          </div>
          <DialogTitle className="text-lg text-gray-950">{title}</DialogTitle>
          <DialogDescription className="leading-6 text-gray-600">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-start">
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={() => onOpenChange(false)}>
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmActionButton, MessageDialog };
