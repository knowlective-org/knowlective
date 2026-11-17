// The sidebar hidden on a wide screen (components/app-shell.tsx): remembered
// per browser, and put on <html> (data-sidebar="hidden") by this script in
// the root layout's <head>, before the page is drawn, so a hidden sidebar
// doesn't flash in. No dependencies (used by the server and the browser).

export const SIDEBAR_HIDDEN_KEY = "knowlective-sidebar-hidden";

export const RESTORE_SIDEBAR_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_HIDDEN_KEY)})==="1")document.documentElement.dataset.sidebar="hidden"}catch(e){}`;
