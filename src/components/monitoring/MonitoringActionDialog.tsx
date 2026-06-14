import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  actionContextText,
  actionDescription,
  actionTitle,
  bulkActionDescription,
  bulkActionTitle,
  type PendingAction,
  type PendingBulkAction,
} from "@/lib/monitoringActions";
import { Loader2 } from "lucide-react";

interface MonitoringActionDialogProps {
  pendingAction: PendingAction | null;
  pendingBulkAction: PendingBulkAction | null;
  actionLoading: boolean;
  onCancel: () => void;
  onConfirmAction: () => void | Promise<void>;
  onConfirmBulkAction: () => void | Promise<void>;
}

export function MonitoringActionDialog({
  pendingAction,
  pendingBulkAction,
  actionLoading,
  onCancel,
  onConfirmAction,
  onConfirmBulkAction,
}: MonitoringActionDialogProps) {
  const context = actionContextText(pendingAction, pendingBulkAction);

  return (
    <AlertDialog
      open={!!pendingAction || !!pendingBulkAction}
      onOpenChange={(open) => {
        if (open) return;
        onCancel();
      }}
    >
      <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-lg p-4 sm:p-6">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingAction
              ? actionTitle(pendingAction)
              : pendingBulkAction ? bulkActionTitle(pendingBulkAction.type, pendingBulkAction.tweetIds.length) : ''}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingAction
              ? actionDescription(pendingAction)
              : pendingBulkAction
                ? bulkActionDescription(pendingBulkAction.type, pendingBulkAction.tweetIds.length)
                : ''}
            {context && (
              <span className="mt-2 block rounded-md bg-muted p-3 text-xs text-foreground">
                {context}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0 [&>button]:w-full sm:[&>button]:w-auto">
          <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={pendingAction ? onConfirmAction : onConfirmBulkAction} disabled={actionLoading}>
            {actionLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
