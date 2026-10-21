# knowlective

English | [日本語](README.ja.md)

A self-hostable, open-source tool for sharing documents and knowledge, with a block editor and real-time collaborative editing (built from scratch).

## About the name

KNOWLECTIVE combines KNOWLEDGE and COLLECTIVE: a place where a team's knowledge gathers and grows together.

## Structure

- `apps/web` — Next.js. The screens, Server Actions and collaborative editing (Hocuspocus) run together in one process on one port, through a custom server (`apps/web/server/`)
- `packages/shared` — Shared package with the Prisma schema and types

The editor is [BlockNote](https://www.blocknotejs.org/) (based on Tiptap/ProseMirror), collaborative editing uses [Yjs](https://github.com/yjs/yjs) + [Hocuspocus](https://tiptap.dev/docs/hocuspocus), the database is PostgreSQL, and Redis pub/sub is used for horizontal scaling.

## Setup

```bash
cp .env.example .env
pnpm gen:server-key        # Put the output in KNOWLECTIVE_SERVER_KEY in .env
pnpm gen:storage-key       # Run twice; put the outputs in SEAWEEDFS_ACCESS_KEY / SEAWEEDFS_SECRET_KEY in .env (letters and digits only)
docker compose up -d       # Postgres + Postgres for semantic search (pgvector) + Redis + SeaweedFS (file storage)
pnpm install
pnpm db:generate           # Generate the Prisma client
pnpm db:migrate            # Prisma migrations in packages/shared
pnpm db:seed               # Create a demo knowledge root and page ("demo")
```

> The development PostgreSQL is encrypted with pg_tde too (the same setup as the bundled production database). If you have an older development database (PostgreSQL 16, volume `knowlective_postgres_data`), move it with `bash docker/postgres/move-to-tde.sh`.
>
> The app reads the `.env` at the repository root. Values in `apps/web/.env.local` and the like take precedence.
> Restart the development server after changing the root `.env`.

## First-time setup and encryption

The first visit goes to `/setup`, where you set the master password, the site's public URL and the default language. The public URL is used in emails and invitation links, and can be changed later under "Site settings" in the admin console.
A key for encrypting page content (the data key) is generated at the same time.

- The data key is never stored in plain text. It is stored in the database encrypted in two ways (envelope encryption):
  - with a key derived from the master password (scrypt) … for recovery and key rotation
  - with the server key `KNOWLECTIVE_SERVER_KEY` … so the key can be unlocked automatically at startup
- Page content (the Yjs state) is stored encrypted with AES-256-GCM. A leaked database or backup alone doesn't reveal it.
- Email addresses and the audit log (who changed what) are stored encrypted too. To look up an address (login, invitations, etc.), the app compares hashes made with a key derived from the data key, not the address itself.
- The bundled PostgreSQL also encrypts the whole database (pg_tde in Percona Server for PostgreSQL: tables, indexes and WAL). Data the app doesn't encrypt itself (page titles, file names, group names, etc.) can't be read from a copy of the disk or volume either. The keys are in a separate volume (`postgres_tde_keys`): **back it up separately from the data** (without it the database can't be read). Anyone who can connect to the database still sees plain text, so this doesn't replace the app's encryption. With a PostgreSQL of your own, this encryption is up to your environment.
- If `KNOWLECTIVE_SERVER_KEY` is lost or leaked, or you want to replace it, issue a new server key with the master password:

  ```bash
  pnpm rotate-server-key
  ```

> **If both `KNOWLECTIVE_SERVER_KEY` and the master password are lost, page data can't be recovered.**
> Keep both somewhere safe.

## Knowledge roots and pages

Pages are organized in trees, one per "knowledge root". On screen, a knowledge root appears as its root page (the knowledge root's name is the root page's title).

```
Knowledge root (root page page1)
 └ page1-1
     └ page1-1-1
```

Root pages can't be deleted.

### Screens

Opening `/` reopens the page you opened last (the first time, or if you no longer have access to it, the root page of the first knowledge root you can see). The left sidebar lists every knowledge root you can see (only the open page's tree is expanded), followed by "Shared with you", "+ New knowledge root", a link to the admin console (content managers and site admins only), and log out.

### Page permissions

Permissions to view and edit pages are always given to groups (never to individuals, so they aren't forgotten when people come and go). Site roles don't matter: even a site admin can't see pages without a permission.

- Giving a page "group × view / edit / manage" carries down to its child pages
- For the same group, the first permission found walking up from the page to its parents applies ("edit" on the root and "view" on a page in between makes everything below that page view-only)
- Someone in several groups gets the strongest permission
- "Manage" allows changing the permissions of that tree
- When someone can see a child page but not its parent, the page appears under "Shared with you" on the home screen (the hidden parent's title and the knowledge root's name aren't shown)
- The built-in "All users" group contains every enabled user automatically (including people who register later). To show a page to every registered user, give this group "view" in "Permissions". Its members can't be edited and it can't be deleted
- People with "manage" can add, change and remove a page's group permissions from "Permissions" in the "⋯" menu at the top right of the page. A root page needs at least one group with "manage"

### Publishing pages (viewing without logging in)

A wider audience than "All users": pages can be shown to people who aren't logged in.

- **Only available when a site admin allows it under "Public pages" in the admin console's overview** (not allowed by default). Withdrawing the permission makes published pages need a login again at once (the publish settings stay, and come back if it's allowed again)
- Once allowed, people with "manage" can publish a page from "Publish to the internet" in its permissions. The page and every page under it (including ones created later) are published. Pages below can't be unpublished on their own
- A published page can be viewed (not edited) by anyone who knows the URL. The left pane lists only published pages, with a "Log in" link. Images, attachments, and child page lists, tables and boards can be seen, but people's names (assignees, etc.) aren't shown. Search, history and the page menu aren't available
- Opening a page that isn't published shows the login screen as before (without revealing whether the page exists)
- Personal knowledge roots ("My pages") can't be published. Publishing, unpublishing and changing the permission are recorded in the audit log
- **Top page**: choosing a page under "Top page" in the admin console's overview shows it to anyone who opens the top of the site (`/`) with nowhere else to go (one setting, whether or not they're logged in).
  - Logged in: the page they opened last, if any. Otherwise (e.g. right after signing up), the top page. If they can't see it, the first page they can see
  - Not logged in: the top page every time (usable as a landing page), but only while the page is published. If it isn't (never published, unpublished, in the trash, or publishing no longer allowed), the login screen
  - The choices are the pages the admin making the setting can see, and the published pages (titles of pages the admin can't see aren't shown, not even to admins). "None" keeps the previous behavior
- **Search engines**: while "Keep out of search engines" in the same section is on (the default), every response of the site (pages and attachments) carries `X-Robots-Tag: noindex, nofollow`, telling search engines not to list them. Turned off, published pages may appear in search results. robots.txt isn't used to stop crawling (stopping it would keep the noindex instruction from reaching search engines, and URLs linked from other sites could be listed without content). Whether search engines follow the instruction is up to them, so don't publish pages you don't want seen

### Page menu

"Share" at the top right of a page copies its URL (using the site's public URL). The "⋯" next to it shows the creator, creation time, last editor, last update time and owners (groups with "manage" on the page, including ones inherited from pages above), and opens the page menu (history, lock, permissions, export, move, delete).

### Moving and reordering pages

Drag pages in the page list on the left to change their order or place.

- Dropping on the top or bottom edge of a row puts the page before or after it; dropping in the middle makes it that page's last child. Hovering over a collapsed page for a moment expands it. Pages can also move to another knowledge root
- "⋯" → "Move" on a page lets you choose the destination from a list of the pages you can see (the page goes last among the chosen page's children)
- Reordering within the same parent needs edit permission on the parent
- Moving to another parent needs edit permission on the page and every page under it, and on the destination. Knowledge root pages can't be moved. A page can't be moved into itself or a page under it
- A moved page takes its permissions from the destination (permissions given directly to the page stay). If who can see it changes, the change per group is shown for confirmation before moving. Moves to another parent are recorded in the audit log
- Editors open on a moved page reconnect and have their access checked again (people who lost access can no longer open it)
- The order is reflected in child page lists and tables. New pages go last. Reordering and moving don't change a page's update time

### Full-text search

The search box at the top of the sidebar (or `/search`) searches the titles, text and attachment names of the pages you can see.

- Partial matches. Full-width/half-width and upper/lower case are ignored. Separating words with spaces finds pages containing all of them
- Results with a title match come first, then the most recently updated (top 50). The matching parts of the text are highlighted
- Pages you can't see and pages in the trash never appear
- The index is encrypted: the text is cut into 1–2 character fragments, and only their values (hashes) under a search key derived from the data key are stored. A leaked database doesn't reveal the text (at most, which pages share a sequence of characters could be guessed). Results are shown only after decrypting the candidate pages to confirm them
- The index is updated on every save. At startup, pages with an outdated index are re-indexed

#### Search by meaning

Pages close in meaning can be found even without the same words (e.g. "what do I do when I want a day off" finds the page on applying for paid leave). There's one search box, and the kind of search is chosen from the query.

- Sentence-like queries show pages close in meaning in addition to pages with the same words (results found by the words alone aren't marked "Close in meaning"). Short queries (up to 4 characters in Japanese and the like, or 2 words in English), queries with digits or symbols (model numbers, URLs, etc.) and queries in brackets or quotes are searched as typed. The screen says which search was used and offers the other one
- Page text is cut into passages of about 300 characters, each turned into a vector representing its meaning, and the passages closest to the query's vector are found. The model is the multilingual multilingual-e5-small (MIT license), run on this server's CPU. **Neither queries nor page text are sent outside** (the Docker image includes the model, and nothing is downloaded while running)
- The vectors are kept in a separate database (PostgreSQL + pgvector) from the content database. Vectors can't be encrypted by the app (the database computes distances), and they roughly represent page content, so they're kept apart from the content database, and this database is encrypted as a whole with pg_tde too. It holds only page IDs, passage positions and vectors, never the text. It can always be rebuilt from the content database, so it needs no backup
- Saved pages are reflected a little later (a few to a dozen or so seconds after editing settles). At startup, pages not yet reflected are processed
- To go without it, don't set up the vector database (with `VECTOR_DATABASE_URL` empty, only word search is used)

### Page history

"⋯" → "History" at the top right of a page shows its past versions.

- While a page is being edited, a version is saved every 10 minutes, and when everyone has closed the page (if there were edits). Pages that existed before the history feature get a "Start of history" version the first time they're opened
- Each version shows its time and who edited in that period. Choosing one shows its content read-only
- With edit permission, "Restore this version" puts the page's content (title and text) back to that version. The content just before is kept as a "Before a restore" version, so the restore itself can be undone. It shows on the screens of people who have the page open too
- Version content is stored encrypted with the data key. Child page table values (column values) aren't part of the history
- Old versions aren't deleted automatically yet
- **Masking confidential text**: if something that mustn't be there (a password, etc.) was written, enter the text (one per line) under "Mask confidential text" on the history screen to replace it with "●●●●" in every version of the page. Available with edit permission
  - "Search" first shows how many versions and places were found. It can't run while the current page (text or title) still contains the text (remove it from the page first)
  - Text split by formatting (e.g. bold in the middle), link URLs and block settings (table titles, etc.) are covered too
  - Versions are rebuilt and saved, so the original text doesn't remain in the stored data. Masked versions stay in the history (shown masked) but can't be restored. Versions are never deleted (for auditing)
  - The text entered isn't saved or logged. The audit log only records how many places in how many versions of which page were masked
  - Browsers that had the page open can still bring it back with Ctrl+Z until reloaded. It also remains in (encrypted) database backups, so handle that operationally if needed

### Deleting and the trash

"⋯" → "Delete" at the top right of a page moves it to the trash along with its child pages (it isn't removed completely).

- Deleting needs edit permission on the page and every page under it (a page with child pages you can't see or edit can't be deleted). Knowledge root pages can't be deleted
- Screens showing the page switch to "This page was moved to the trash"
- "Trash" at the bottom of the sidebar lists the pages you can restore (those you can edit). "Restore" puts them back where they were, child pages included
- Pages whose original parent is also in the trash (deleted separately, before the parent) are shown grayed out with "The parent page is in the trash". "Choose where to restore" puts them back under a page you can edit in the same knowledge root (by default, the nearest remaining page above). They take their permissions from the new place, so this is recorded in the audit log
- Attachments and child page table values are kept, so restored pages work as before. Deleting from the trash completely isn't available yet

### Creating knowledge roots

Content managers and site admins can create one from "+ New knowledge root". The group to get "manage" is either a new group (the creator joins it automatically) or an existing one.

### Headings

The page title is the page's only H1, so headings in the text are H2–H6 only (the slash menu has no Heading 1, and `# ` doesn't make a heading). Headings pasted from outside (HTML or Markdown) move down one level (H1→H2 … H5→H6, H6 stays H6). Copy and paste within knowlective keeps them as they are. H1s left in older pages become H2 when someone who can edit opens the page.

### Child page lists and tables

Press `/` in the editor to insert blocks for pages. Both show only the pages the viewer can see, and adding child pages, renaming them and changing values show at once on everyone's screen.

- **Child page list**: links to child pages with their last update time (1–3 levels). A title can be given at the top left
- **Child page table**: a table with a row per child page. Columns (text, date, user, select) can be added, and creation time, creator, update time and last editor can be shown
  - A title can be given at the top left of the table (saved in the page's document). "+ New page" in the bottom row creates a child page from the title you type (Enter to keep creating; needs edit permission on the parent page)
  - Column definitions belong to the parent page, so every table on the same page shares the same columns. Each table can only change the column order, which columns are shown, and sorting
  - Drag the grip (⋮⋮) at the left of a column header to change the column order (automatic columns such as the creation time too; the title is always first)
  - Adding and changing columns needs edit permission on the parent page; editing a cell needs edit permission on that child page
  - User columns offer only people who can see the page
  - Column names, options and values are stored encrypted with the data key
  - The update time and last editor change when the text, title or a cell value changes

## Attachments

Drag and drop (or paste) files into the editor to attach them. Images, video and audio are shown in place; other files can be downloaded.

- Files are stored in S3-compatible storage. By default it's the SeaweedFS bundled with Docker Compose (`localhost:8333`), and the `knowlective` bucket is created automatically the first time. External S3 (AWS, Cloudflare R2, MinIO, etc.) is set up under "Files" → "File storage" in the admin console
- The app encrypts files with the data key before storing them. The storage only ever holds encrypted data
- Files are served through `/api/files/<id>`, only to people who can see the page they're attached to. Anything other than images, video and audio (HTML, SVG, PDF, etc.) is downloaded rather than shown in the browser
- View-only permission can't add files
- Markdown, text and Word files (.md / .txt / .docx) can be attached or have their content expanded into the page. A Markdown file can also "Replace this page": the page's title and body become the file's content (the title is the file's leading heading `# …`, or the file name if there isn't one). The content from before the replace stays in the page's history
- The largest file size is set under "Files" → "Upload limit" in the admin console (100 MB by default, 500 MB at most). It applies wherever files are stored (bundled or external)

### Moving file storage

Changing the storage location is infrastructure work; the app doesn't move existing files. Object keys are `<key prefix>files/<file ID>` and don't depend on the settings, so copying the bucket as a whole is enough (the contents move still encrypted).

1. Copy everything under `<prefix>files/` in the current storage to the new one (e.g. `aws s3 sync`, `rclone sync`, `mc mirror`)
2. Set the new storage under "File storage" in the admin console (with existing files, you're asked to confirm they've been moved)
3. Check with "Connection test" that existing files are found in the new storage

## Users and login

Accounts are by invitation only at first. Issue an invitation link under "Invite users" in the admin console (`/admin`) and hand it over. Self-registration can also be allowed in the settings (below).

- An invitation sets the role after registering and the groups to join (access to pages comes from groups). When someone who already has an account accepts an invitation, they're only added to the groups (their role doesn't change)
- Invitation links are valid for 7 days, work once, and are shown only when issued
- With email sending set up, check "Send an invitation email" to email the link. If sending fails the link still works, so hand over the link on screen directly
- Login is by email address and password. 10 failures within 15 minutes from the same address or for the same email address lock logging in
- A page can only be opened by members of groups with permission on it

### Display language

The screens, emails and audit log support Japanese and English.

- **Screen language**: the language chosen on the "Account" screen; otherwise the browser's; otherwise the site's default language.
- **Site default language**: chosen during first-time setup and in the admin console's overview (Japanese by default).
- **Emails**: in the recipient's language. Addresses without an account (invitations) get the site default.
- **Audit log**: written in the site's default language.

#### Adding another language

For example, to add French (`fr`):

1. **Add it to the list of languages**: add `"fr"` to `LOCALES` in `apps/web/src/i18n/locales.ts`, and its name in itself to `LOCALE_NAMES` (`fr: "Français"`). It then appears in the choices on the account screen, the admin console and first-time setup, and is picked from the browser's language (Accept-Language) too.
2. **Create the text files**: copy the folder `apps/web/src/i18n/messages/ja/` to `messages/fr/` and translate. English (`messages/en/`) is the source of truth for the keys, and each file is typed `MessageShape<typeof en>`, so missing or extra keys show up in the type check.
   - The format is ICU (`{name}`, `{count, plural, one {…} other {…}}`, `{x, select, …}`). Plural forms can be written per language.
   - `editor.slash.*Aliases` are extra words (comma-separated) so the slash menu can be searched with words in that language.
3. **Register it**: add `fr` to `MESSAGES` in `apps/web/src/i18n/messages/index.ts`.
4. **Editor text**: make `apps/web/src/i18n/blocknote.ts` return BlockNote's dictionary for that language (e.g. `fr` from `@blocknote/core/locales`). Languages BlockNote has no dictionary for stay in English.
5. **Check**: run `pnpm --filter web exec tsc --noEmit` to confirm no keys are missing or extra, then look at the screens with the browser set to that language (or with it chosen on the account screen).

No database changes are needed (`User.locale` and `InstanceConfig.defaultLocale` are language-code strings). PDF export bundles only the Inter and Noto Sans JP fonts, so a language with characters they can't show (Chinese, Korean, etc.) also needs a font added to `/api/export-assets`.

### Password reset

- Entering an email address under "Forgot your password?" on the login screen (`/forgot-password`) emails a reset link (valid for 60 minutes, works once). Needs email sending to be set up
- The screen looks the same whether or not the account exists (so it can't be used to find out who's registered). Disabled accounts and accounts that can't log in with a password (single sign-on only) aren't emailed
- Requests are limited to 5 an hour from the same address and 3 an hour for the same account (beyond that, nothing is sent and the screen doesn't change)
- Without email sending, or when the person can't receive email, a site admin issues a link (valid for 24 hours, works once) from "⋯" → "Issue a password reset link" in the user list under "Users" in the admin console, and hands it over. It's shown only when issued, and can also be emailed
- Issuing a new link makes earlier ones stop working
- Resetting ends every session of that account (the admin console's included). Links issued by admins and completed resets are recorded in the audit log

### Self-registration

Under "Users" → "Registration" in the admin console (site admins only), switch between "By invitation only" (the default) and "Anyone can register". "Anyone can register" needs email sending to be set up.

- Entering an email address under "Create an account" on the login screen (`/signup`) emails a registration link (valid for 24 hours, works once). The person sets a display name and password from the link (which also confirms the address)
- The role of people who register is either user (the default) or content manager (not site admin). They join no groups
- The email domains that can register can be limited (empty for no limit; list subdomains separately)
- Addresses already registered get an "already has an account" email instead, and the screen looks the same (so it can't be used to find out who's registered)
- Requests are limited to 5 an hour from the same address and 3 an hour for the same email address
- Going back to "By invitation only", or removing the domain or email sending, makes registration links already sent stop working. The role is the one set when registration is completed
- Changes to the settings are recorded in the audit log

### Single sign-on (OpenID Connect)

Under "Users" → "Single sign-on (OpenID Connect)" in the admin console (site admins only), logging in with an identity provider (Microsoft Entra ID, Google, Keycloak, etc.) can be enabled.

- Checking "Enable single sign-on" shows the other settings (unchecking and saving disables it; the settings are kept)
- Settings: issuer URL, client ID, client secret (stored encrypted), button name (empty: "single sign-on" in each viewer's language), and the attribute for the display name (optional; empty uses name, then preferred_username; taken from UserInfo if not in the ID token; used only when an account is created). Register the redirect URI shown on screen (`<public URL>/auth/oidc/callback`) with the identity provider. "Connection test" checks that the identity provider's settings can be read
- Authorization code flow (PKCE, state, nonce). ID tokens are verified by the certified `openid-client` implementation
- People logging in for the first time: if their verified email address matches an existing account they're linked to it; otherwise an account is created (the role is user or content manager; the email domains allowed to get accounts can be limited). At the first login the identity provider's user ID (`sub`) is saved in the User's `oidcSubject` (and `oidcIssuer`), and from then on that links them, so the same account is used even if the email address changes. If another identity-provider user with the same email address tries to use an account already linked to a different user ID, it's refused
- "Verified" is the identity provider's `email_verified`. For identity providers that don't send it (Microsoft Entra ID, etc.) there's a "Treat the identity provider's email addresses as verified" setting (don't use it with identity providers where users can set any email address)
- Password login is either "Alongside single sign-on" (the default) or "Single sign-on only". Even with the latter, site admins can log in with a password, so nobody is locked out if the identity provider fails
- Disabled users can't log in with single sign-on either
- Logging in to the admin console (`/admin`) still takes a password plus an authenticator app. Accounts created by single sign-on have no password at first, so they can't get into the admin console (even ones created as content managers). With password login "Alongside", they can set one through a password reset
- Logging out of knowlective doesn't log out of the identity provider

### Passkeys

Instead of a password, you can log in with a passkey (fingerprint, face, or the device's PIN). "Log in with a passkey" on the login screen has the browser offer its passkeys for the site (no email address needed).

- Register and remove them from "Account" in the sidebar. You can register several, one per device, each with a name (stored encrypted)
- Under "Users" → "Passkeys" in the admin console (site admins only), "Require passkeys" can be turned on (off by default: optional)
  - On: someone who logs in with a password can't open anything else until they register a passkey (they're sent to `/passkey-setup`; logging out still works)
  - Accounts with a passkey can no longer log in with their password. The last one can't be removed
  - Logging in with single sign-on is exempt (the identity provider authenticates)
- Someone who lost their passkeys gets them removed from the user list in the admin console ("⋯" → "Remove passkeys", which also ends their sessions). They log in with their password again, and register a new passkey if required
- A passkey only works at the address (host name) it was registered at. Opened at an address other than the public URL (an internal IP address, etc.), it has to be registered again for that address. Browsers also only use passkeys over https or on localhost
- With "Single sign-on only", passkeys, like passwords, log in site admins only
- Logging in to the admin console (`/admin`) still takes a password plus an authenticator app (unaffected by the passkey settings)

## Admin console (`/admin`)

Each user has one site-wide role. Permission to view and edit pages comes from groups, not roles (even a site admin can't see pages without a permission).

| Role | Can do |
|---|---|
| Site admin | Everything in the admin console (except server-side tasks). Changing roles, disabling users. Can invite any role |
| Content manager | "Users" (inviting only) and "Groups" in the admin console. Can invite only content managers and users |
| User | Can't get into the admin console |

The admin console has the pages Overview, Users, Groups, Files and Security (content managers see only "Users" and "Groups"). There are two ways to log in, and both need an authenticator app (TOTP), registered at the first login.

- **Log in with an account (usual):** site admins and content managers log in with their own email address, password and authenticator app. Changing their role to user or disabling them locks them out at once, even while logged in
- **Log in with the master password (initial setup and recovery):** `/admin/login?mode=master`. Used to register the first site admin, or when no admin can get in

First steps: log in with the master password → under "Users", invite yourself with the role "Site admin" and register (if already registered, change your role from "⋯" in the user list) → from then on, log in with your account. The last site admin can't be demoted or disabled.

Groups are for giving permissions on page trees. The "Groups" page creates, renames and deletes them and manages their members. Content managers can only handle groups whose permissions are all on pages they manage (including groups with no permissions yet). The same goes for the groups they can choose when inviting.

Changes to roles, enabling/disabling accounts, password resets, registering and removing passkeys, group members, page permissions, knowledge root creation and invitations are recorded in the audit log, which can be seen on the "Security" page (newest first, 20 per page).

- **Login:** master password + the authenticator app's 6-digit code
- **Rate limit:** 5 failures within 15 minutes from the same address lock that address
- **Sessions:** separate from regular users'. They end after 30 minutes without activity, or 12 hours after logging in
- **IP restriction:** the IP addresses and CIDRs allowed into the admin console can be set. Other addresses get a 404

### Theme

"Overview" → "Theme" sets the colors of the whole site (pages, admin console, login screen): primary (text color, default #173C3C), primary (light) (sidebar background etc., #E8F2F2), background (#FAFAF8) and secondary text (#687280). There's a preview, and combinations that are hard to read (contrast ratio under 4.5) are warned about.

### Sending email

Set up the SMTP server under "Sending email" in the admin console. After saving, check it with "Send a test email".

- Fields: sender email address, sender name, SMTP server, port, encryption (STARTTLS / SSL/TLS / none), SMTP AUTH (user name and password)
- With STARTTLS, nothing is sent if the server doesn't support STARTTLS (it never falls back to sending unencrypted)
- Encryption "none" and SMTP AUTH can't be used together (the password would be sent in plain text)
- The SMTP password is stored encrypted with the data key and never shown. Saving with it empty keeps the saved password

If you're locked out of the admin console, recover on the server with the master password:

```bash
pnpm admin:recover --reset-totp          # Lost the authenticator app for the master password (register again at the next login)
pnpm admin:recover --reset-user-totp=<email address>  # A site admin lost their authenticator app
pnpm admin:recover --clear-ip-allowlist  # Locked out by the IP restriction
pnpm admin:recover --clear-lockout       # Clear the lock after failed logins
```

### Production prerequisite (reverse proxy)

The client IP is taken from `X-Forwarded-For`, so **never expose Next.js directly to the internet: always put it behind a reverse proxy (Caddy, nginx, etc.).** Exposed directly, the IP can be spoofed and the rate limits and IP restriction stop working.

- The proxy must **append** the client to `X-Forwarded-For` and pass `X-Forwarded-Proto` (for nginx, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` and `proxy_set_header X-Forwarded-Proto $scheme;`). Without `X-Forwarded-Proto: https`, the admin console's cookies don't get Secure.
- With two or more proxies (e.g. CDN → nginx), set `KNOWLECTIVE_TRUSTED_PROXY_HOPS` to that number.

### Serving under a sub-path (`KNOWLECTIVE_BASE_PATH`)

To serve the app under a sub-path rather than the host's root, like `https://example.com/knowlective/`, set the environment variable `KNOWLECTIVE_BASE_PATH` to that path (e.g. `/knowlective`). The default is empty (served at the root).

- Pages, the admin console (`/knowlective/admin`), the API and the collaborative-editing WebSocket (`/knowlective/collab`) all go under this path. The health check is `/knowlective/api/health` too.
- **The reverse proxy must pass the path to the app unchanged** (`/knowlective/login` forwarded as `/knowlective/login`). For nginx, `location /knowlective/ { proxy_pass http://127.0.0.1:3000; }` (no `/` at the end of `proxy_pass`). Pass WebSocket upgrades through this location too.
- Enter only the origin (`https://example.com`) as the "public URL" in the admin console, without the sub-path. Links in invitation emails and the like get the sub-path automatically. The current value is shown in the admin console's overview.
- The value takes effect at startup. With Docker, edit `.env.production` and run `docker compose … up -d` again (no need to rebuild the image). Without Docker, set it before `pnpm build` (it's built in).
- With SSO, change the redirect URI registered with the identity provider to `https://example.com/knowlective/auth/oidc/callback` as well.
- Changing the sub-path makes logged-in people log in again (cookies are scoped to the path). Page content and attachments keep working.

## Running in production

### Docker Compose (recommended)

Runs the app (Next.js and collaborative editing in one container), SeaweedFS (file storage) and the bundled PostgreSQL (or a PostgreSQL of your own). It's a separate project (`knowlective-prod`) from the development `docker-compose.yml`, so they share no containers or volumes even on the same machine.

```bash
./install.sh
```

`install.sh` asks for the settings, writes `.env.production`, and builds and starts everything (needs Docker, Docker Compose v2 and bash).

- For the database, choose "the bundled PostgreSQL" (Percona Server for PostgreSQL 17, with the whole database encrypted by pg_tde) or "a PostgreSQL of your own" (16 or later recommended). For your own, create the database and user first and let the user create tables (migrations create them at startup). After entering the connection, you can check that the container can actually connect. Inside a container `localhost` is the container itself, so use the server's address even for a PostgreSQL on the same server
- Choose whether to use search by meaning. If so, the bundled vector database (`bundled-vectordb`) is started too (it uses a few hundred MB more memory)
- The server key (`KNOWLECTIVE_SERVER_KEY`) is either generated, or entered when moving or restoring. The bundled SeaweedFS's credentials and the bundled PostgreSQL's password are generated
- Running it again remakes `.env.production` with its current values as defaults (the old file is kept as `.env.production.bak.<timestamp>`). The server key and the bundled PostgreSQL's password are kept (changing them would make the data unreadable or the database unreachable)

To configure by hand, copy `.env.production.example` to `.env.production`, fill in the values and start with:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

- The app listens on `127.0.0.1:3000` (change with `KNOWLECTIVE_PORT`). Serve it through a reverse proxy (above), and open `https://<public URL>` for the first-time setup
- Every start applies any pending database migrations first (`KNOWLECTIVE_SKIP_MIGRATIONS=1` stops that). To update, `git pull` and run the same `up -d --build`
- On stopping (`docker compose stop`, etc.), open documents are saved before exiting
- The health check is `GET /api/health` (200 if the database can be reached; `<sub-path>/api/health` when served under a sub-path). The container has a health check set too
- Run recovery commands inside the container: `docker compose -f docker-compose.prod.yml --env-file .env.production exec app pnpm admin:recover --clear-lockout` (`rotate-server-key` likewise)
- **Backups**: the PostgreSQL and SeaweedFS volumes (`knowlective-prod_seaweedfs_data`), plus `.env.production` (`KNOWLECTIVE_SERVER_KEY`). The contents are encrypted, so backups can't be restored without the key
  - The bundled PostgreSQL also needs its encryption keys (volume `knowlective-prod_postgres_tde_keys`). Keep them **somewhere separate from the data (`knowlective-prod_postgres_tde_data`)** (kept together, encrypting the whole database means nothing)
  - `pg_dump` output has the whole-database encryption removed (columns the app encrypts stay encrypted), so store the file encrypted
- **Updating from before the bundled PostgreSQL was encrypted**: after `git pull`, move the old bundled database (PostgreSQL 16, volume `knowlective-prod_postgres_data`) into the encrypted one with `bash docker/postgres/move-to-tde.sh prod` (the data flows straight from `pg_dump` into `pg_restore`, leaving no unencrypted dump file). Once it works, delete the old volume with `docker volume rm knowlective-prod_postgres_data`
- Redis is only needed to relay collaborative editing between several app containers, so it isn't bundled (not needed for one). To use it, set `REDIS_URL`

To build just the image: `docker build -t knowlective .`. The environment variables needed are `DATABASE_URL`, `KNOWLECTIVE_SERVER_KEY` and (for the bundled SeaweedFS) `SEAWEEDFS_ACCESS_KEY`, `SEAWEEDFS_SECRET_KEY` and `KNOWLECTIVE_BUNDLED_S3_ENDPOINT`.

### Without Docker

```bash
pnpm build
pnpm --filter shared exec prisma migrate deploy
pnpm start         # Starts with NODE_ENV=production. The port is PORT (default 3000)
```

The reverse proxy must also pass WebSocket connections (the Upgrade header) to `/collab` (`<sub-path>/collab` when served under a sub-path).

## Development

```bash
pnpm dev           # http://localhost:3000 (the collaborative-editing WebSocket is /collab on the same port)
```

## License

Copyright (C) 2026 hachibay

knowlective is published under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

- You're free to use, modify and redistribute it. If you distribute a modified version, or provide a modified version as a service over a network, you must provide its users with the modified source code under AGPL-3.0
- Dependencies are under their own licenses (BlockNote is MPL-2.0; most others are MIT / Apache-2.0)
- The admin console shows a link to the source code at the bottom left (by default https://github.com/knowlective-org/knowlective ). If you run a modified version, set the environment variable `KNOWLECTIVE_SOURCE_URL` to where the modified source code is published
