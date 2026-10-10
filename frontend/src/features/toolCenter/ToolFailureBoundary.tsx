import { Component, type ReactNode } from "react";
import { t } from "../../shared/i18n";

// Isolate one opened tool. Never retry a possibly effective operation on render failure.
export class ToolFailureBoundary extends Component<{
  children: ReactNode;
  onFailure(): void;
  onDirectory(): void;
  recovery?: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() { this.props.onFailure(); }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="ui-card tool-detail" role="alert">
      <h3>{t("Tool view unavailable")}</h3>
      <p>{t("This tool's view failed. Other tools are still available.")}</p>
      <p>{t("An operation may still be running or may have completed. Check its effects before reopening this tool. Nothing was retried automatically.")}</p>
      {this.props.recovery}
      <button type="button" className="ui-button ui-button--secondary" onClick={this.props.onDirectory}>{t("Tool directory")}</button>
    </section>;
  }
}
