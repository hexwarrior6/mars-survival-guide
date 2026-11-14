/** Error boundary around the WebGL canvas: a failed renderer falls back to the
 * 2D plan view instead of a dead stage (SPECIFICATION.md: 2D fallback usable). */

import { Component } from "react";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  onFallback: () => void;
}

interface State {
  failed: boolean;
}

export class WebglErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.error("3D sandbox failed:", error);
    this.props.onFallback();
  }

  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
