import { useState, type ReactElement, type ReactNode } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

export function ConfirmSettingsAction({ title, description, confirmLabel, onConfirm, disabled, children }: {
  title: string; description: ReactNode; confirmLabel: string; onConfirm: () => void | Promise<unknown>; disabled?: boolean; children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return <AlertDialog open={open} onOpenChange={(next) => { if (!pending) { setOpen(next); setFailed(false); } }}>
    <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription asChild><div className="space-y-2">{description}</div></AlertDialogDescription></AlertDialogHeader>
      {failed && <p role="alert" className="text-sm text-destructive">The action could not be completed. Review its result before trying again.</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        <AlertDialogAction className="h-auto min-h-11 whitespace-normal" disabled={pending || disabled} onClick={async (event) => {
          event.preventDefault();
          if (pending || disabled) return;
          setPending(true);
          try { await onConfirm(); setOpen(false); } catch { setFailed(true); } finally { setPending(false); }
        }}>{pending ? 'Working…' : confirmLabel}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
