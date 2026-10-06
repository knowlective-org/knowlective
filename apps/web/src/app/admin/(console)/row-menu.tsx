"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/styles/ui.module.css";

export type RowMenuItem = {
  label: string;
  action: (formData: FormData) => Promise<void>;
  // Hidden inputs posted with the action (e.g. { userId }).
  fields: Record<string, string>;
  danger?: boolean;
  // Shown in a confirm() dialog before submitting.
  confirm?: string;
};

// "⋯" menu at the end of a table row. The menu is position: fixed so the
// table's horizontal-scroll wrapper doesn't clip it.
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = () => setPos(null);
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // A fixed menu would drift away from its row.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        data-ui="RowMenu.toggle"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={styles.kebab}
        onClick={() => {
          if (open) return setPos(null);
          const r = buttonRef.current!.getBoundingClientRect();
          setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
      >
        ⋯
      </button>
      {open && (
        <div ref={menuRef} data-ui="RowMenu.menu" role="menu" className={styles.menu} style={{ top: pos.top, right: pos.right }}>
          {items.map((item) => (
            <form
              key={item.label}
              data-ui="RowMenu.itemForm"
              action={item.action}
              onSubmit={(e) => {
                if (item.confirm && !window.confirm(item.confirm)) e.preventDefault();
                else setPos(null);
              }}
            >
              {Object.entries(item.fields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <button
                data-ui="RowMenu.item"
                type="submit"
                role="menuitem"
                className={item.danger ? styles.menuItemDanger : styles.menuItem}
              >
                {item.label}
              </button>
            </form>
          ))}
        </div>
      )}
    </>
  );
}
