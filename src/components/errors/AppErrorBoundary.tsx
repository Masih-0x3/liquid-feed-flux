import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureAppReactException } from "@/instrument";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureAppReactException(error, {
      componentStack: info.componentStack ?? null,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background p-6 text-foreground">
          XOT hit a rendering error. Refresh to retry.
        </div>
      );
    }

    return this.props.children;
  }
}
