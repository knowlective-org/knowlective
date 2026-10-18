"use client";

import { useEffect, useSyncExternalStore } from "react";

// "Something on this page is still being saved", for the "saving" mark at the
// top of a page. The parts that save (the editor's connection, the child-page
// board) are far from the toolbar that shows it, so they report here.

// The mark stays a little after the last save finishes: typing saves many
// times a second, and it would flicker.
const LINGER_MS = 700;

let pending = 0;
let visible = false;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function update() {
  clearTimeout(hideTimer);
  if (pending > 0) {
    if (!visible) {
      visible = true;
      listeners.forEach((listener) => listener());
    }
    return;
  }
  hideTimer = setTimeout(() => {
    visible = false;
    listeners.forEach((listener) => listener());
  }, LINGER_MS);
}

// Call when a save starts; call the returned function when it has finished
// (calling it more than once is harmless).
export function beginSaving(): () => void {
  pending++;
  update();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending--;
    update();
  };
}

// For a component whose saving state is a boolean it already has.
export function useReportSaving(saving: boolean): void {
  useEffect(() => {
    if (!saving) return;
    return beginSaving();
  }, [saving]);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Whether the "saving" mark should be showing.
export function useSaving(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => visible,
    () => false,
  );
}
