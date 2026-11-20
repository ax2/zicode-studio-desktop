import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Move only view controls into the shell; the editor and its draft stay mounted. */
export function PageHeaderActions({ owner, locked = false, children }: {
  owner: string; locked?: boolean; children: ReactNode;
}) {
  const slot = document.getElementById("page-header-actions");
  if (!slot) return <>{children}</>;
  return createPortal(
    <div className="page-header-content" data-page-header-owner={owner} inert={locked} aria-busy={locked}>
      {children}
    </div>, slot,
  );
}
