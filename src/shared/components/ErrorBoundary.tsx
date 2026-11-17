import { Component, type ErrorInfo, type ReactNode } from "react";
import { Icon } from "@/shared/icons/Icon";
import { Button } from "./Button";

interface Props {
  /** Changing this resets the boundary (e.g. the current section id). */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Contains a failing section so the rest of the app keeps working. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Section crashed", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="panel mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-lg px-6 py-8 text-center">
        <Icon name="error" size={20} className="text-danger" />
        <div>
          <p className="text-sm font-medium text-fg">This section ran into a problem.</p>
          <p className="mt-1 text-xs text-fg-muted">The rest of Vaalytics is unaffected. Details were written to the log.</p>
        </div>
        <Button size="sm" icon="refresh" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
