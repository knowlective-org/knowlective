# Changelog

Notable changes to KNOWLECTIVE, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/), and versions follow [Semantic Versioning](https://semver.org/).

Until 1.0.0, a MINOR version (0.**x**.0) may contain changes that need attention when updating; they're listed under **Upgrade notes**. From 1.0.0 on, those come only with a MAJOR version: removed or renamed environment variables, database migrations that need manual steps, incompatible changes to `/api/v1`, and higher minimum Node.js or PostgreSQL versions.

Add each change under "Unreleased" as it's made. `pnpm release <version>` turns that section into the release's.

## [Unreleased]

### Added

- Chat blocks: replies (the message replied to is quoted above, and a click on the quote shows it), mentions ("@" offers the people who can open the page; they're notified of the mention), links for the URLs in messages, and the messages' text can be selected and copied
- Chat blocks can be locked by anyone who can edit the page: no new messages, and messages can't be changed or taken back, until it's unlocked
- Code blocks: "Format" at the top right, with the indent to use (2 or 4 spaces, or a tab; remembered in the browser). JavaScript, TypeScript, JSON, CSS, HTML, Vue, Markdown, YAML and GraphQL are formatted with Prettier, SQL with sql-formatter; other languages have their indentation changed to the one chosen
- Child page tables: a "Masked text" column type. Its values are encrypted in the browser with the column's passphrase (chosen with the first value), so the server only ever has the encrypted form; "Show" in the column's header asks for the passphrase
- Child page boards: sub-groups, a board per value of a second column (a select or a user column), one under another; a card moves to another sub-group with its own picker
- The ⋮⋮ menu: "Copy" (to the clipboard: pasted into a page, the blocks come back as they were) and "Duplicate"
- Search engines (once allowed in the admin console): /robots.txt points to /sitemap.xml, which lists the public pages; a public page has a description (the start of its text), its canonical URL, Open Graph and Twitter card tags, and structured data (an article)

### Changed

- Code blocks list their languages A to Z (plain text first)
- Every screen's title, and the app's name when added to the home screen, end with the site's name (the one at the top left) instead of "KNOWLECTIVE"

### Fixed

- Enter in the title of a toggle (or a toggle heading) with blocks inside moved those blocks out, into a new toggle below. They now stay: an open toggle continues with a new first block inside, a closed one with a new toggle below
- Deleting the block of one of three columns, while another column was empty, turned the layout into a single column. It now keeps two

### Upgrade notes

- Two database migrations (chat replies and locks, the masked column type), applied on start as usual

## [0.1.1] - 2026-11-05

### Added

- Attachments are deleted, stored file included, 30 days after no page shows them any more (their block was removed). Undoing, pasting the block back or restoring the page from the trash within that time keeps them; old versions don't, so restoring one after that shows the file as missing
- Files dropped outside the blocks (onto the title, the margins or below the last block) go at the end of the page, with the same choices as a paste: expand or attach a Markdown or text file, attach anything else
- Chat blocks: a thread of messages with a box to write in below it. Your own messages are on the right, everyone else's on the left with their name. You can change your own messages (shown as edited, with when) or take them back (the text is removed and "Unsent" stays in its place); nobody can change someone else's. Posting needs edit permission; people who can view the page read along
- Masked text: text locked with a passphrase, encrypted in the browser, so the page (and the server, the history and search) holds only the encrypted form. A forgotten passphrase can't be recovered
- Two- and three-column layouts, each column holding its own blocks (also by dropping a block at another's side). On a phone-width screen the columns are shown one under another
- Child page tables: a "Text (several lines)" column type, showing at least its first 200 characters whole
- Child page tables: filters (words in text, ticked options or people, a date range; every condition must match). Filters and sorting by a column are each person's own, saved to their account so they follow them to other devices; an editor can make their sort the table's sort for everyone, and "Back to the table's view" drops their own
- File paths in a page's text (`C:\…`, `\\server\share\…`, `file://…`) are marked, and a click copies them: a browser can't open files or folders on your computer. A path runs to the end of its line, spaces included (`\\server\共有 フォルダ\…`); one in quotes or 「」 ends at the closing quote
- Code blocks: syntax highlighting by language (Perl included), picked on the grey label at the block's top left or with ```` ```python ````; no spellcheck; Ctrl/Cmd+A selects the block's code (press again for the whole page)
- TODO blocks in place of the check list (in the slash menu, the block type menus, `[ ] ` and pasted Markdown check lists): an assignee from the people who can open the page, a due date (marked once it's past), and who ticked it and when. Check lists already in pages stay, and can be turned into TODOs from the ⋮⋮ menu
- A page in a child page table shows its values in the table's columns under its title, and they can be changed there (by those who can edit the page)
- Inherited access can be narrowed on a child page's "Permissions": Edit to View or No access, View to No access, for that page and the pages below. Never made stronger; groups managing the pages above can't be changed. "Inherit again" undoes it. Open editors reconnect when access changes

- Notifications: new messages in chats you're in (you posted in it, follow its page or are mentioned there), TODOs given to you or past their date, changes to pages you follow (once until you open the page again), and mentions. A bell in the sidebar with the unread count, a list under it, and settings on the account screen to choose which ones, or turn them all off
- Desktop notifications, also when the site isn't open: turn them on per browser on the account screen. Each person chooses whether they show who, which page and an excerpt, or only the kind of event. On iPhone and iPad they need the site added to the home screen
- Following a page (the "Follow" button at the top of a page)
- Mentions: type "@" in a page to mention someone who can open it

### Changed

- The log out icon is now a box with an arrow pointing out of it, to the right

### Fixed

- An open, empty toggle showed its "Toggle" placeholder in the middle of the line instead of where its title goes
- On iPad (and phone browsers), the bottom of the left pane (account, trash, log out) was hidden behind the browser's toolbar; dialogs and the history list could run under it too
- After saving a setting, a drop-down list or a checkbox showed the old value until the page was reloaded (the admin console, the account's language, a page's permissions)

### Development

- Continuous integration on GitHub Actions (`.github/workflows/ci.yml`): types, lint, access checks, unit tests, `pnpm audit`, gitleaks, the Docker image with trivy, and the end-to-end tests on a fresh database, on every push to `staging`, pull requests to `master`, and weekly
- `KNOWLECTIVE_E2E_SETUP=1 pnpm e2e:seed` sets up a fresh database before making the test accounts

### Upgrade notes

- Desktop notifications are sent from the server to the browsers' push services (fcm.googleapis.com, updates.push.services.mozilla.com, *.push.apple.com, *.notify.windows.com) over HTTPS. If the server can't reach them, turn desktop notifications off in the admin console's overview; the notifications in the app work either way
- The database gets a new access level (`NONE`), a table of the attachments each page shows, a column type for child page tables, a table for chat messages (with when each was edited or taken back), and one for each person's filters and sort of child page tables; the migrations run at startup. Notifications add tables of their own, a per-person setting and a site setting. Existing pages' attachments are worked out at startup; until every page has been, nothing is deleted

### Security

- After logging in, a `next` path containing a tab or line break is no longer followed: browsers drop those characters, so `/<tab>/evil.example` would have led to another site (an open redirect)
- Uploaded logos: namespaced elements (`<svg:script>`), `handler` / `listener` / `feImage`, and event attributes right after a quote, slash or colon are refused too
- PDF blocks only load the app's own attachments (`/api/files/<id>`): the URL comes from the shared document, and anything else would make every viewer's browser fetch an address of an editor's choosing
- Unit tests for the checks on untrusted input (`pnpm test:unit`: link-preview addresses, logos, URLs from the document, attachment names, the post-login path), and an end-to-end check that page bodies, attachment text and email addresses never reach the database in plain text
- Collaborative editing: the name and color on a person's cursor are set by the server from who is logged in (a browser could show itself as someone else), and a connection can't send cursor states for anyone else's editor
- Searching for members to add to a group: at most 120 searches a minute per admin
- New tests: an access matrix (every screen and route of a page, as each kind of account; the share screen's Server Actions posted directly by people who mustn't use them) and the collaboration server (forged, expired, other-page and not-logged-in tokens; edits from a read-only connection; cursors claiming to be someone else)
- Next.js 16.3.1 → 16.4.3 (fixes several unauthenticated remote code execution advisories, among them one in the image optimization endpoint), nodemailer 10.2.1, Prisma 7.10.1, and patched indirect dependencies (Tiptap, ProseMirror, DOMPurify, sharp and others). `pnpm audit --prod` is down to one low-severity advisory (KaTeX through Mermaid, not fixable within Mermaid's range yet)
- Security headers on every response: framing by the site itself only, no MIME sniffing, `base-uri` / `object-src` restricted, Referer limited to the origin for other sites, camera / microphone / location / payment APIs off. The admin console keeps its stricter ones
- Reading attachments' text (Word, Excel, PowerPoint) stops at 64 MB unpacked, so a "zip bomb" can't exhaust the server's memory
- `pnpm check:auth`: fails when a Server Action or Route Handler doesn't check access, or app code bypasses the network policy. `pnpm security:scan`: that, `pnpm audit`, gitleaks, and (optionally) trivy on the image


### Changed

- Links in a page's text are bold and underlined, with a link icon after them, so they stand out from the text
- Child page tables: saving a select column's options says "Saved" (and "Not saved yet" while there are changes)
- Adding members to a group in the admin console: suggestions while typing, by display name or email address; several people can be picked (shown as badges) and added at once

## [0.1.0] - 2026-10-28

### Added

- The first version: a self-hostable document and knowledge sharing tool with a block editor and real-time collaborative editing.
  - Knowledge roots and page trees, personal "My pages", group permissions (view / edit / manage), publishing pages to the internet, page locks, history with restore and masking, trash
  - Editor: Markdown, Word and text import, attachments, PDF viewer, Mermaid diagrams, link previews, video embeds, child page lists, tables and boards; Markdown and PDF export
  - Full-text search (pages and attachment contents, with an encrypted index) and search by meaning (on the server)
  - Login with passwords, passkeys and single sign-on (OpenID Connect); invitations and self-registration; password reset
  - Admin console with roles, groups, audit log, IP and network restrictions, email, file storage, theme, site name and logo, and version information
  - Public API with personal API keys (pages as Markdown)
  - Encryption of page content, history, attachments, search index, email addresses and the audit log; the bundled PostgreSQL is encrypted as a whole (pg_tde)
  - Docker Compose / Podman installation (`install.sh`)
