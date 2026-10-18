// Line icons for the sidebar's footer links (24×24, drawn with the text
// color). Decorative: each link carries its name in aria-label and title.

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function AccountIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </Icon>
  );
}

export function TrashIcon() {
  return (
    <Icon>
      <path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </Icon>
  );
}

export function AdminIcon() {
  return (
    <Icon>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </Icon>
  );
}

export function LogoutIcon() {
  return (
    <Icon>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />
    </Icon>
  );
}

export function LoginIcon() {
  return (
    <Icon>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l4 4-4 4M13 12H3" />
    </Icon>
  );
}
