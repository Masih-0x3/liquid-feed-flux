import { useState, type ReactElement } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

export function ConfirmMediaAction({ title, description, actionLabel, onConfirm, children, disabled = false }: {
  title: string; description: string; actionLabel: string; onConfirm: () => void;
  children: ReactElement; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <AlertDialog open={open} onOpenChange={setOpen}>
    <AlertDialogTrigger asChild disabled={disabled}>{children}</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={disabled} onClick={() => { if (!disabled) onConfirm(); }}>{actionLabel}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
