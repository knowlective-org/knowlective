import type { ReactNode } from "react";
import ui from "@/styles/ui.module.css";

// A form's status or error message beside its button, on the button's left
// (the account screen and the admin console's settings). The message element
// is always there (aria-live), and takes room only when it has text. Every
// form's save button in the admin console goes in one: there the row is
// right-aligned (ui.module.css, .adminPane .statusRow).
export function StatusRow({
  message,
  className,
  dataUi,
  children,
}: {
  message: ReactNode;
  className: string | undefined;
  dataUi: string;
  children: ReactNode;
}) {
  return (
    <div className={ui.statusRow}>
      <p aria-live="polite" className={className} data-ui={dataUi} style={{ margin: 0, marginRight: message ? 12 : 0 }}>
        {message}
      </p>
      <div style={{ display: "flex", gap: 12 }}>{children}</div>
    </div>
  );
}
