import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "chat-settings-panel": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      "cost-dashboard": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        "defer-load"?: boolean;
        embedded?: boolean;
      };
    }
  }
}
