import React from "react";
import { translateCurrent } from "./shared/i18n/translate";

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: ""
  };

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  public componentDidCatch(error: unknown): void {
    console.error("Polarbear frontend crashed", error);
  }

  public render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <main className="startup-error">
          <h1>{translateCurrent("error.startTitle")}</h1>
          <p>{this.state.message}</p>
          <p>{translateCurrent("error.consoleHint")}</p>
          <button
            type="button"
            className="startup-error-reload"
            onClick={() => window.location.reload()}
          >
            {translateCurrent("error.reloadApp")}
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
