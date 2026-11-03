import styles from "./notice.module.css";

// A short message at the bottom of the screen that goes away by itself
// (e.g. "copied"). A newer one replaces the one showing.
let current: { el: HTMLElement; timer: number } | null = null;

export function showNotice(message: string, ms = 4000): void {
  if (current) {
    clearTimeout(current.timer);
    current.el.remove();
  }
  const el = document.createElement("div");
  el.className = styles.notice;
  el.setAttribute("role", "status");
  el.dataset.ui = "Notice";
  el.textContent = message;
  document.body.append(el);
  const timer = window.setTimeout(() => {
    el.remove();
    if (current?.el === el) current = null;
  }, ms);
  current = { el, timer };
}
