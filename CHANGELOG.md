# Changelog

Notable changes to knowlective, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/), and versions follow [Semantic Versioning](https://semver.org/).

Until 1.0.0, a MINOR version (0.**x**.0) may contain changes that need attention when updating; they're listed under **Upgrade notes**. From 1.0.0 on, those come only with a MAJOR version: removed or renamed environment variables, database migrations that need manual steps, incompatible changes to `/api/v1`, and higher minimum Node.js or PostgreSQL versions.

Add each change under "Unreleased" as it's made. `pnpm release <version>` turns that section into the release's.

## [Unreleased]

### Added

- Whiteboards have hexagons (the hexagon tool, X): level top and bottom, corners at the middle of the left and right, every inner angle 120°. Their width and height can be anything but taller than a regular hexagon (Shift: a regular one). Connectors meet them at a corner or the middle of a side (elbow connectors: the left and right corners and the middles of the top and bottom)

- People can set a picture of themselves on the account screen (made a small square in the browser; PNG, JPEG or WebP). It's shown by their name: at the bottom of the sidebar, on their chat messages, in the "@" menus, as a TODO's assignee and in the admin console's user list. Without one, the first letter of their name is shown. Like names, only to people who are logged in

- Review chats beside the page, like comments: "Start a chat" in a top-level block's ⋮⋮ menu opens a chat about that block in a pane on the right, which stays in view as the page scrolls. Blocks with a chat show a mark with the number of messages; a chat can be resolved (the mark goes) and reopened, and a new message reopens it. They aren't part of the page: not printed, exported or searched. Anyone who can open the page reads them; those who can edit it post and resolve. Everything a chat block has works in them (replies, reactions, mentions, files, notifications)

- Cells of a child page table can be selected like a spreadsheet (drag across them, or click one and Shift+click another) and copied with Ctrl/⌘+C as a table, for spreadsheets and documents: what they show (an option's or a person's name, a date, a masked value only while its column is shown). Ctrl/⌘+C in a single cell copies that cell

- The API and MCP can read a page's child pages with their properties (the values in its child page table's columns): `GET /api/v1/pages/<id>/children` (all columns, or `?property=<name>` for some) and the MCP tool `get_child_properties`

- The API and MCP can send people a notification about a page, with a text of up to 2,000 characters whose links work: `POST /api/v1/pages/<id>/notifications` and the MCP tool `send_notification`. Only to people who can open the page (`GET /api/v1/pages/<id>/people`, MCP `list_page_people`), by someone who can edit it. They appear in the notification list (a new kind, "messages", that can be turned off on the account screen) and as desktop notifications

- MCP can rename pages (`rename_page`), as the API's `PATCH /api/v1/pages/<id>` already could

- Whiteboard boxes can be made transparent (a new color in the selection bar): the board shows through, and shapes keep their outline. Exports draw them without a fill

- Parts of a whiteboard's text can be made bold, italic, underlined or struck through, and given a text color (the selection bar's buttons, or Ctrl/⌘+B, I, U and Ctrl/⌘+Shift+S): select words while typing, or select items to style their whole text. The text colors are dark ones that stay readable (a contrast of 4.5:1 or more) on every item color. Exports keep the styles; text written through the API or MCP loses them

- Public pages' link cards (Open Graph and Twitter / X) show an image: the knowledge root's favicon when it's a PNG and the root page is public, otherwise the app icon

- Single sign-on can let in people the identity provider has no email address for (admin console → single sign-on → "Allow accounts without an email address"): their account is made without one, only while no email domains are listed. An address that isn't verified isn't kept. They can add one later on the account screen, or a site admin can ask for one from the user list

- Site admins can change another user's email address from the admin console (the user list's "⋯" menu): a code is mailed to the new address, and the address changes when the user signs in and enters it on their account screen. The user can turn it down, and the admin can cancel it. Needs mail sending to be set up

### Changed

- The whiteboard's toolbar has one button for the shapes drawn by dragging (rectangle, ellipse, diamond, hexagon): it draws the last one chosen, and its corner mark opens the others. Their keys (R, O, D, X) still work and change the button too

- The product's name is written in lower case, "knowlective", everywhere: the default site name (and "powered by knowlective"), screen titles, emails, the admin console, the authenticator app and passkey names given to new registrations, and the documentation. A site name or email sender name still set to the old default "KNOWLECTIVE" is changed to it; one set to anything else stays as it is. Environment variable names (`KNOWLECTIVE_…`) don't change

- A mention in a chat message has more room around the name, in a slightly smaller font

- A whiteboard text item is as tall as its text: its handle (now on its right edge) changes only the width, and the height follows as you type

- Tab and Shift+Tab in an extended table work as in a table: to the next or previous cell, with its content selected, also from a cell with text in it. Where the block has a Tab of its own, that comes first: a code block indents, a list item or TODO with one above it nests under it, and Shift+Tab takes a nested block back out

- Pages in your personal knowledge root (My Page) can be moved out into other knowledge roots, to share a draft: from the page menu's "Move" or by dragging in the sidebar. Like any move, what changes in who can see it is confirmed first. Pages from other roots still can't be moved into a personal root

- New whiteboard connectors are drawn like the last connector you styled (arrowheads, straight or elbow, line style), remembered in your browser

- Tab in an empty cell of the last column of an extended table goes to the first cell of the next row, instead of the cell below

- Choosing the whiteboard for a document's whiteboard block lists whiteboards only, each after the titles of the pages above it, instead of every page with the others greyed

- The sidebar lists every child page by default. Folding pages with many child pages is now each person's choice, with how many are listed (account screen → "Sidebar"), and the "N more pages" row lists the rest in place instead of opening a dialog

- Every save button in the admin console is on the right, with its message beside it (site name and logo, desktop notifications, auditors, API, adding files and network access were on the left)

- Shapes and text pasted from Miro without a fill come in transparent instead of white (frames without a color stay white)

- The whiteboard's selection bar shows one button for the shape, with the shapes in its menu, so the bar fits on one row with the new text buttons

### Fixed

- Security: the `effect` package that Prisma's configuration uses is raised to 3.22.4, fixing a ReDoS (GHSA-7589-6fvf-x4pw)

- On a whiteboard, the placeholder of a new item's text stayed over Japanese (or other IME) input until it was confirmed

- Links in a table's cells looked like plain text: they're now bold and underlined with a link icon, like links in the rest of the page

- A whiteboard connector inside a transparent box (a frame around boxes and their connectors) couldn't be clicked: the frame was selected. Clicking its line now selects the connector, and elsewhere in the frame, the frame

- ↑ / ↓ in a TODO stopped on a line between blocks, then at the start of the next TODO's text. They now go straight to the block above / below (a nested TODO first) with the caret at the end of its text, also when coming into a TODO from another block

- Tab in a TODO that can't be indented could move the focus to its checkbox after some text had been selected and the selection was gone

### Upgrade notes

- Pages left open from before the update ask to be reloaded before they can be edited again (the collaborative editor's version changed)

### Changed

- On the account screen, the MCP section is titled "MCP", and "Copy the address" copies the MCP server's address straight to the clipboard (a dialog to copy it by hand only where the browser doesn't allow it, such as on plain http)

## [0.4.0] - 2026-11-18

### Upgrade notes

- Behind a reverse proxy with `KNOWLECTIVE_BASE_PATH`, AI apps that connect over OAuth look for `/.well-known/oauth-authorization-server<base path>` at the root of the domain: pass that path on to KNOWLECTIVE as well if you turn the MCP server on

### Added

- An MCP server at `/api/mcp`, for AI apps (Claude, ChatGPT, Cursor…) to search, read and write pages as the person who connected them, with their permissions. Part of the API: turned on in the admin console's API settings (off by default). Apps connect with OAuth (this site is the authorization server: the person signs in and agrees, choosing read-only or read and write; dynamic registration and client ID metadata documents) or with a personal API key; connected apps are listed, and disconnected, on the account screen. Writes create pages, add to their end or replace one section under a heading — never a whole page, and not a section holding blocks Markdown can't carry back unchanged

### Security

- The dependency audit ignores GHSA-fc5q-39xc-vjpf (picomatch, no fixed version yet): it's reached only through next-intl's message extraction, which isn't used

## [0.3.2] - 2026-11-17

### Added

- A knowledge root can have its own favicon (PNG, ICO or SVG), set from its root page's menu by those who manage it: shown in the browser's tab on its pages and by its name in the sidebar, to everyone who can open the root page
- The sidebar can be hidden (its button at the top right) and shown again (a button at the top left), remembered per browser
- The sidebar marks pages that are public on the internet (readable without logging in) with a globe

### Security

- Next.js updated to 16.4.6 (GHSA-mfr8-8qww-v76h)

### Changed

- The sidebar folds a page's child pages into "N more pages" from 6 of them on (was 31): the 5 most recently changed stay listed, newest first, with the one on the way to the open page
- Opening a page no longer covers the screen with a loading overlay (it made pages show more slowly)
- Choosing someone from the "@" menu (in a page and in a chat) puts a line break after the mention, not a space
- Whiteboard: Shift held while dragging keeps the drag straight across or straight down (whichever way it went further); with Ctrl/⌘ also held as it ends, the drag leaves a copy there and the original stays, as Alt does
- Extended table: Tab in an empty cell goes to the next cell (the one to the right, else the one below; nowhere from the last), and in a cell with text it nests the block under the one above, as elsewhere in the page (Shift+Tab takes it back out)

## [0.3.1] - 2026-11-16

### Security

- Fixes for several security issues found in a review of the source code; please update to it. Published as GitHub security advisories:
  - GHSA-v98x-r7j4-vmmc (medium): moving a page could make its trashed sub-pages readable to the mover
  - GHSA-x8h8-c4f7-9cwr (medium): an address registered through an invitation without a recipient could be linked to that person's single sign-on, sharing the account
  - GHSA-q24v-2p79-6p32 (medium): copying files from another page in someone else's editor could expose files of pages the copier can't open
  - GHSA-h6fx-j7j8-ch9p (medium): search could show excerpts and names of attachments from pages the searcher can't open
  - GHSA-f8c6-wgqc-27hr (low): concurrent requests could exceed the limit of 5 tries for a 6-digit confirmation code
  - GHSA-p95g-7f3q-pw5j (low): many simultaneous sign-ins could slow the whole server (scrypt)

### Added

- Extended table: a ⋮⋮ handle on its left, as other blocks have, to drag the table elsewhere or duplicate or delete it; table data pasted into a cell (from a spreadsheet or another table) fills the cells from there, adding the rows and columns it needs (up to 200 rows and 20 columns); a column can be selected with its button at the top, then copied, emptied (Delete), given a text color, background or alignment, moved left or right (or dragged), or deleted
- A URL pasted into text becomes a link reading as its page's title: a page of this site (if the person pasting can open it), or another site's page while link previews are on (the title fetched as for a preview). A URL alone on an empty line still becomes a preview card
- A linked view's page can also be chosen by pasting its address in the page picker
- Linked views: "リンクテーブル", "リンクボード" and "リンクカレンダー" in the slash menu show another page's child pages, with that page's columns, as a table, board or calendar. The page is chosen when the block is inserted (and can be changed later). Each viewer sees what their own access allows: those who can't open the page see only that it can't be shown, without its title. Values can be changed and child pages added (under that page, with edit access there) from the linked view; columns are added and changed only on that page. Changes show on pages with linked views as they're made, and a child page shows its values under its title while a linked view shows them, even without a table on its own parent
- Opening a page shows a loading overlay over the whole screen while its data is read and its content arrives (after a moment, so a quick load doesn't flash). Before, the previous page stayed as it was until the new one appeared
- Images and files in chats: attach them with the 📎 button, or paste or drop them on the chat (up to 10 per message, with or without text). They're stored as the page's attachments, with the same checks as other uploads (file uploads on, allowed extensions, size limit). Images show in the message, other files are links to download them, and attached files are searchable like messages. Taking a message back takes its files with it
- The child page list and board can be sorted (list: by title, creation or last change; board: the cards in each lane, by any column). As in the child page table, each person's order is their own and kept on their account; those who can edit the page can make theirs the order for everyone
- A code block's "Format" lays out code in more languages, code written on one line (minified) included: C, C++, Java, C#, Objective-C (clang-format), Python (Ruff), shell scripts (shfmt), Lua (StyLua), PHP, XML and Pug, with the chosen indent. The formatters run in the browser and load the first time they're used (clang-format is a few MB). Other languages still only have their indentation changed
- Code pasted into a code block takes the indent chosen in its picker (2 spaces, 4 spaces or a tab), each line keeping its level
- Memory settings for the bundled PostgreSQL and vector database in `.env.production` (`POSTGRES_SHARED_BUFFERS`, `POSTGRES_EFFECTIVE_CACHE_SIZE`, `VECTORDB_SHARED_BUFFERS`; PostgreSQL's defaults if unset). Raising `shared_buffers` (about a quarter of the memory) makes reading faster, since the encrypted database decrypts each page it reads from disk
- An access log: one line per request on standard output (the container's log) with the time, client IP, method, path (without the query string; tokens in invitation, password reset and email change links left out), status, milliseconds and the X-Forwarded-For header as received. On by default in production; `KNOWLECTIVE_ACCESS_LOG=0` turns it off
- More reactions in chats: 👌 🙆 (got it), 🙇 (thanks) and 💯, in two rows
- Shortcuts to a page ("ショートカットを作成" in the page menu, below "移動"): an entry in the page list, under any page one can edit (one's own root too), that opens the page. It's placed with the same dialog as a move, and is moved, reordered and removed (with the "×" on its row, to the trash) like a page; the page itself stays where it is. What it shows depends on each viewer's own access to the page: those who can't open it see "(開けないページ)", without its title, and its address is "not found" for them. Nothing can be added under a shortcut, and the child page blocks, the API's Markdown and the sitemap leave shortcuts out
- A list of a page's child pages ("子ページの一覧" in the page menu, when it has child pages one can open), filtered by title
- In a PDF block's full screen, the page can be zoomed (50–400%, with the buttons beside the page number, +, - and 0, or Ctrl/⌘ + the wheel) and dragged around when it's larger than the window
- The move dialog filters the pages by title, each match shown after the titles of the pages above it
- Knowledge roots in the admin console ("ナレッジルート", site admins; auditors view it): every knowledge root but the users' own, with its name, number of pages, the groups with access and when it was made, and nothing of what's in it. A knowledge root can be deleted there (typing back a code to confirm): nobody can open any of its pages any more, nor find them in search, and pages open in it are closed. Nothing is removed, and it can be restored on the same screen, with the same access. Both are recorded in the audit log
- Copy, cut and paste on a whiteboard (Ctrl/⌘+C, X, V): the selected items, with the connectors between them, paste under the pointer (or in the middle of the screen), also on another whiteboard; pasting again there puts each copy a little further down and to the right, and one undo takes a paste back. Images pasted on another page become that page's own attachments, as for blocks. Other apps get the items' text. Items copied in Miro paste as the board's own: sticky notes (their color matched to the nearest of the board's), rectangles, ellipses, diamonds, text, connectors with their labels and the sides they're attached by, lines, and frames (a rectangle with the title above); Miro's images, drawings and other kinds are left out, with a note saying how many. Text from elsewhere becomes a text box
- CSV files (and TSV) dropped or pasted into a page can be attached or expanded into a table, its first row the header row (UTF-8 or Shift_JIS; quoted fields may hold commas and line breaks; up to 1,000 rows and 50 columns, more is cut off with a note). Like Markdown and text files, they can be expanded with adding files turned off

### Changed

- Pages and the page list on the left load faster: a page's permissions are read in fewer steps, and the knowledge roots in the page list are read all at once instead of one after another
- A page with more than 30 child pages doesn't list them all in the page list on the left any more: only the one on the way to the open page, with "ほか N ページ" (or "N ページ", when none of them is open) for the rest, which opens the list of its child pages
- A wrong passphrase for a masked column is said in the passphrase dialog, to type again, instead of a second dialog; the dialog stays open, saying it's checking, while the passphrase is checked
- A whiteboard's two boxes can be joined by more than one connector, through different sides: a connector is refused only where one already joins them by the same sides (a connector drawn without choosing a side matches any side)
- Code blocks have a little room above and below them

### Fixed

- In the extended table, ↓ went to the cell on the right instead of the one below; ↓ and ↑ now move within the column, and out of the table from its last and first row
- A date typed as digits (20261116) didn't become 2026/11/16: the browser took up to six digits of year
- A new page under one whose child page table, board or calendar has columns showed those (empty) columns under its title; they now show once the page has a value in one
- Quoting selected text in a chat no longer makes the message a reply (a reply already started, to any message, stays one)
- Quoting selected text of a chat message worked only some of the time: pressing the "引用" button could clear the selection (and the button with it), and a triple click didn't offer it at all. Over one's own message the button is now inverted, as it was hard to see on the message's color
- Tab (or Shift+Tab) in a list item or TODO that couldn't be indented (an empty first item, for one) moved the focus out of the text, to the next control on the page such as a TODO's checkbox. It now does nothing
- After a wrong passphrase (a masked column, for one), selecting the field's text with the mouse and letting go outside the dialog closed it. The field is now also cleared for the next try
- A deleted block could come back a few seconds later, multiplied (#41): an editor that had missed someone else's change (seen in tabs left open a long time) wrote its whole, older content back on its next edit, adding the deleted blocks again as new ones, once per such tab. An editor now checks for that before writing, and instead of writing, redraws itself from the shared document (the edit that set it off is lost); it also checks when its tab comes back into view
- In a chat, someone whose name has an "@" in it (such as "山田@営業部") could not be mentioned: the "@" list closed at the second "@". An email address in a message (ann@example.com) could also turn into a mention of someone whose name followed the "@"
- Confirming a dialog with Enter in its text field (the code typed back to delete a knowledge root or unlock a page, a passphrase) also pressed the button that had opened it, so the same dialog came straight back (the first one had already done its work) until cancelled
- A page showed its parent's columns (such as the date a calendar block made) under its title even when the parent no longer had a child page table, board or calendar (or had only the plain child page list). They now show only while the parent has one of those blocks; the columns and their values are kept
- The change log in the admin console showed site admins the titles of pages they can't open (pages moved, locked, their permissions changed, published, masked in the history, or chosen as the landing page). Such titles are now hidden ("閲覧できないページ") from those who can't open the page; an entry recorded before this one, naming such a page, is shown only as hidden. Knowledge roots' names still show
- A PDF block's full screen took only the window's width, staying where the block was, when the block was selected (as clicking it does): the editor's style for a selected block won over it
- In an HTML code block, CSS in a `<style>` element and JavaScript in a `<script>` element weren't highlighted, and everything after them was colored as invalid. Every language's grammar is now used as written (Shiki's precompiled grammars lose the `\G` anchor these rules rely on)
- Dragging a block by its ⋮⋮ handle with Ctrl (Option on a Mac) held copied it when dropped onto another block, but moved it when dropped in the margins or below the last block. It's copied there too now
- In a chat's message box, typing right after picking someone from the "@" list could put the first letter at the end of the message, after what was typed next
- Attachments (images, videos, files, PDFs) in a block copied from another page could only be opened by those who could open the page they were uploaded on: everyone else got 404 for them (a block copied from one's own root showed its file to oneself only). When someone who can edit the page, and can open the file's page, has the page open, the file is now copied to the page as its own and the block points to the copy, for everyone. Blocks pasted before this are fixed the same way, the next time such a person opens the page. Markdown written through the API gets the same, and the absolute attachment URLs the API's Markdown export writes are taken back as this site's attachments (before, a page written back with them lost track of its files, which were deleted 30 days later)

### Upgrade notes

- A database migration adds `ChatMessage.attachmentIds` (applied on start)
- Editors open before the update must be reloaded (the child page list and board blocks have a new setting): until then they show "reload" instead of the page
- A database migration adds the page kind `SHORTCUT` and `Page.shortcutTargetId` (applied on start)
- Database migrations add `User.emailUnconfirmed` and empty the search index, which is rebuilt in the background on start: until it's done, search finds fewer pages than usual. The semantic search index is rebuilt too
- A database migration adds `KnowledgeRoot.deletedAt` and `deletedById` (applied on start)
- A database migration adds `FileObject.copiedFromId` (applied on start)

## [0.3.0] - 2026-11-11

### Added

- A child page calendar block ("子ページカレンダー" in the slash menu): the page's child pages on a month's calendar, each on the day in a date column (or when it was created or last changed). Drag a card to another day to change its date, or onto "no date" to clear it; "+" on a day adds a child page dated that day; pages without a date wait in a tray below, with a date field. A page with no date column yet offers to make one ("日付"). Each viewer moves between months and filters for themselves (the filter kept on their account, as for the table and board). Markdown and PDF export write it as links to the child pages

- A summary row for the extended table ("集計行" on the table's bar): under each column, its sum, average, count of numbers or of filled cells, minimum, maximum, or, with a condition written as in a spreadsheet ("完了", ">=10", "<>保留", "*" wildcards), how many cells meet it (COUNTIF) or the sum of the rows that do, tested on this column or another (SUMIF). Editors click a column's summary to choose; it follows the cells as they change. Numbers may have separators, currency signs or "%" and be in full-width digits. Markdown and PDF export add it as a last row
- A PDF's text can be expanded into a page or replace the page (title included), as for Markdown files: the choices offered for a PDF now include "ページに展開" and "このページを置き換える". The text is read in the browser (nothing is uploaded for it, so it also works with adding files turned off), larger text becomes headings and lines starting with a bullet or a number list items; images, tables and columns aren't kept. PDFs without text (scanned images) and password-protected ones are refused with a message
- API for chats and whiteboards: `GET /api/v1/pages/<id>/chats` lists a page's chats, `GET`/`POST …/chats/<chat id>/messages` reads and posts messages (as in the chat block: Markdown, mentions as `<@user id>`, replies; the same access, lock and rate limits; those mentioned are notified), `GET`/`POST /api/v1/pages/<id>/whiteboard` reads the board's items and adds, changes and removes them in one request, live on open boards. `POST /api/v1/pages` takes `"kind": "WHITEBOARD"`. See the README's API section
- Filters for the child page board, as for the child page table: by title, any column, who made or changed a page and when. Each viewer's own, kept on their account

- Quoting part of a chat message: select text in a message and a "Quote" button appears above it; it starts a reply with the selected text as a quote in the message box
- In code, a new line keeps the indentation of the line it's made from: Enter in a code block, and Shift+Enter inside ``` fences in a chat message. In a code block, Enter on an indented empty last line drops the indentation, so a third Enter still leaves the block
- Full screen for PDF blocks (the button by the page numbers): the PDF fills the window on the page being read; ← → turn pages and Esc leaves
- Adding files can be turned off for the whole site (admin console → "Files" → "ファイルの追加", site admins; recorded in the audit log). Off, nothing can be uploaded (attachments, images, video, PDFs, whiteboard images, the images in Word files); files already attached still open, and Markdown and text files can still be expanded into a page

### Changed

- Links to this site (pages, search, …) open in the same tab, in the text, chat messages, link previews and read-only pages; links to other sites still open a new tab
- Backspace at the start of an indented block takes it back out one level and keeps its type, undoing Tab; list items, headings and TODOs used to turn into paragraphs first
- A code block's preview is set apart from the code: a light card with a border and a "Preview" badge
- The chat's formatting buttons sit on a darker bar and use the same line icons as the whiteboard (as do the chat's title, lock and poll marks)
- The whiteboard's org chart template: members are stacked under each team and joined from the team's bottom into their left side, with the head's and teams' connectors joined at one point

### Fixed

- Videos (and audio) attached to pages didn't play in Safari and on iPhone and iPad, and couldn't be seeked: attachments now answer range requests (206). `.mov` files and media whose type the browser didn't give are served as playable media

### Upgrade notes

- Pages opened before the update must be reloaded before they can be edited again (the editor's version changed for the extended table's summary row and the child page calendar)
- A database migration adds the setting for adding files (`InstanceConfig.uploadsEnabled`, on); it's applied at startup

## [0.2.2] - 2026-11-08

### Added

- A table of contents block ("目次" in the slash menu): the page's headings (H2–H6), indented by level, each scrolling to its heading. It follows the headings as they're typed. Markdown and PDF export write it as a list of the headings
- The order of the knowledge roots shown to people who aren't logged in can be set in the admin console ("Overview" → "公開しているナレッジルートの並び順", site admins; recorded in the audit log). Roots not placed there, such as one made public later, come first, newest first. Signed-in users keep their own order
- Formatting in chat messages, a part of Markdown: **bold**, *italic*, ~~strikethrough~~, `code`, [links](https://…), bulleted and numbered lists, quotes and code blocks (no headings or tables). Buttons above the message box and Ctrl/⌘+B, I, E format the selection. Messages are kept as typed; search, notifications and reply quotes use the words without the marks

### Changed

- The sidebar lists knowledge roots newest first by default, and roots not yet placed by dragging (a new one) come above the ones placed

### Upgrade notes

- Pages opened before the update must be reloaded before they can be edited again (the editor's version changed for the table of contents block)
- A database migration adds the public knowledge roots' order (`InstanceConfig.publicRootOrder`); it's applied at startup

## [0.2.1] - 2026-11-08

### Added

- Mentioning everyone in a chat: "@" offers "everyone" ("全員") first. Everyone who can open the page is notified of the mention (as for a mention by name, by their own notification settings). Anyone who can post may use it, once every 5 minutes in a chat; sooner is refused, the message kept in the box. Search finds it as "@everyone" in the site's default language
- README: rebuilding the Docker image (`build --pull --no-cache`) for Node.js security updates
- `pnpm release` takes `--trailer "<Key: value>"` lines for the release commit

## [0.2.0] - 2026-11-08

### Added

- Whiteboard pages: a new kind of page (the + next to a page in the sidebar now opens a menu: a block page or a whiteboard) with a canvas of sticky notes, rectangles, ellipses, diamonds, text, lines and connectors, edited together in real time with everyone's pointers shown. Rectangles and ellipses are drawn by dragging (with Shift for a square or a circle), and an item can be changed into another kind (sticky note, rectangle, ellipse, diamond, text). An item's text can be moved by its handle (outside the item too), and text longer than the item runs out below it instead of being cut off. Connectors meet a diamond at its corners only, and an ellipse at eight points 45° apart (at the middles of the sides around it for right-angle connectors). Text can hold bulleted and numbered lists (lines starting with "- " or "1. ", or the buttons; Enter goes on with the list). Connectors are drawn from the dots that show on the sides of a box under the pointer (or with the connector tool), their ends can be dragged onto other boxes, they run straight or turn at right angles (rounded corners, as few turns as it takes, in and out of the sides their ends are dropped by), and they take text halfway along and by each end (double-click where it should go), and they have an arrowhead at the end, at the start, at both ends or at neither (lines too; lines are drawn by dragging, with Shift at 45° steps, and a double-click makes one level or upright). Where connectors cross, the one on top hops over the other. The zoom buttons stop at fixed steps (100% among them), and clicking the zoom shown goes back to 100%. Pan (drag with the right button, scroll) and zoom (Ctrl/⌘ + scroll, pinch), select several items (drag a frame, Shift+click), colors, bring to front / send to back, duplicate (Ctrl/⌘+D, or end a drag with Alt held: a "+" marks what will be copied, and a dashed outline where it started), undo (Ctrl/⌘+Z), keyboard shortcuts for the tools, and a full screen view over the whole window, sidebar included (the button by the zoom, or Esc with nothing selected to leave). Permissions, moving, the trash, locks, history (restore and masking), public pages and search work as for documents
- An auditors group (built in, "監査"; it can't be deleted): its members, added by a site admin on the group's page, can view every page except those in personal knowledge roots, whatever the pages' permissions say, and can sign in to the admin console (with an authenticator app, like admins) to see every section of it without being able to change anything. The group can't be granted on pages or joined by invitation. A site admin can also let them view everyone's personal knowledge root (admin console, "Overview" → "監査"; off by default): read-only, opened from the users list, every page they open there recorded in the audit log, and each person's own root page saying that auditors may view it
- The proxy in the admin console is now for all of the server's connections to the outside, not just link previews: desktop notifications, single sign-on, mail (through an HTTP CONNECT tunnel) and file storage set in the admin console go through it too. It has its own section ("外部への接続（プロキシ）") and a list of hosts reached without it (host names, domains, addresses and ranges); this server itself and the bundled file storage are always reached directly
- Chat blocks have a title (set by anyone who can edit the page; empty shows "Chat", and search finds the page by it), and can be folded to the title alone with the ▾ next to it. Folding is each viewer's own and kept in their browser, as for toggles. Screens opened before this update are asked to reload
- Reactions to chat messages: someone who can edit the page can react to another person's message with one of eight emoji (the ☺+ under the message; a click on a reaction of one's own takes it away). Each reaction shows how many, with who on hover (no names on public pages). Not on one's own messages; a locked chat takes none, and taking a message back removes its reactions
- Polls in chat blocks ("投票" by the message box): a question with 2–10 choices, one or several per person as its author chooses. Votes are named (who chose what shows on hover; only counts on public pages) and can be changed until the poll's author closes it, which can't be undone. The question and choices can't be changed once posted. A locked chat keeps its votes but takes no more; taking a poll back deletes it with its votes. Search finds the page by the question and the choices
- Whiteboards can be shown in documents: the "Whiteboard" block (slash menu) shows a whiteboard page read-only, to be panned, zoomed and opened. Each viewer sees it with their own access: someone who can't open the whiteboard sees only that it can't be shown, not its title. Others' changes to the board (and its title) show as they're made for those signed in
- Images on whiteboards: drop (or paste) them onto the board. They're attachments of the page (PNG, JPEG, GIF, WebP and AVIF), keep their shape when resized (Shift: freely) and can be connected like the other items
- Whiteboard items can link to a page (chosen from the pages you can see; opened with the viewer's own access) from the 🔗 at their corner
- Whiteboard boxes snap to the edges and centers of the others while dragged or resized, with guides showing where (hold Ctrl/⌘ not to snap), or, with "Grid" on, to the board's dots. Several selected boxes can be aligned (left, center, right, top, middle, bottom) or spread out evenly
- Whiteboard templates: KPT retrospective, brainstorm, org chart and 2 × 2 matrix, put in the middle of the screen (one undo takes a template back)
- Whiteboards can be exported as an image (PNG) or SVG from the page menu, in the colors on screen, images included
- A whiteboard says so when a connector is drawn (or an end moved) between two objects another connector already joins
- A connector drawn from a whiteboard object and dropped on the empty board makes a new object of the same kind, size and color there, connected to it
- Whiteboard connectors and lines can be drawn thick, dashed or double, as well as normal (also in the PNG and SVG export), with arrowheads of one size whatever the line
- Several whiteboard objects are lined up with the one selected first, marked with a red dashed outline; clicking another of the selected makes it the one instead (the selection stays)
- Connector ends meeting a whiteboard object at the same point are spread a little apart along its side, so each can be told apart; an object can keep them together instead (its selection bar)
- The public API's page details have a `kind` (`DOCUMENT` or `WHITEBOARD`); replacing a whiteboard's content with Markdown is refused (`not_document`, 409)

### Changed

- The whiteboard's buttons share one set of icons, drawn for it (the buttons that had words too, their names shown on hover), and Ctrl/⌘ + the mouse wheel zooms in smaller steps (a trackpad's pinch as before)
- The people offered as a TODO's assignee or to mention (`@`) are those who can open the page and have a name. People without a name aren't offered any more (their email address was shown instead, to everyone who could open the page)
- A chat message is changed in the message box below the chat (marked "Editing message", Esc or × to stop), not in its bubble. What was being written is put aside meanwhile and comes back after; starting a reply stops the change, and the other way round
- The tables on a page's sharing screen center their cells vertically, so the names, counts and buttons of a row line up

### Fixed

- Chat messages sent before 0.1.4 are now found by search after the server starts, without the page being edited first
- Part of a chat message can be selected and copied (Ctrl/⌘+C). Before, the editor took the selection back as soon as it was made, and copying copied the whole block instead
- On a child page board split into sub-groups by a person column, a long name in a card's picker no longer widens the card's contents: the title stays inside the card instead of spilling into the next lane

### Security

- Someone who loses access (their account disabled, taken out of a group, the group deleted, groups synced from single sign-on, their password reset, their passkeys removed) also loses the editors they have open. Before, an editor already open kept receiving and sending changes until it disconnected
- A mention written by hand into a chat message (`<@id>`) names only someone who can open the page; before, it showed anyone's name (or email address)
- Session cookies are `Secure` when the public URL is https, even if the reverse proxy doesn't send `X-Forwarded-Proto`

### Upgrade notes

- If the public URL (admin console, "Overview") is https, signing in over plain http no longer works (the browser drops the `Secure` cookies)
- A proxy set for link previews is now used for all the connections the proxy now covers (see Added). If the mail server or a file storage set in the admin console is inside your network and the proxy can't reach it, add it to "プロキシを通さない宛先" (admin console, "Overview") right after updating, or mail and attachments will fail
- Pages and whiteboards opened before the update must be reloaded before they can be edited again (the editor's version changed for the whiteboard's new items and fields); edits not yet saved in them are lost

## [0.1.4] - 2026-11-06

### Added

- Search finds chat messages: by their words, and by meaning. Only the chats still in the page count, messages taken back don't, and mentions are found by the name
- Semantic search (by meaning) covers the text of attachments, not only their names

### Changed

- Ticking a TODO also ticks the TODOs nested under it (at any depth). Unticking it leaves them as they are; ones already done keep who completed them, and ones locked against editing are left out

### Fixed

- The Docker image didn't build since 0.1.2 (`pnpm install` couldn't find the patch for `@blocknote/core`)

### Upgrade notes

- The semantic search index is rebuilt from scratch on the first start (every page, its chats and its attachments are embedded again, in the background). Until it has caught up, search by meaning finds fewer pages; search by words works as before

## [0.1.3] - 2026-11-06

### Added

- The site can be installed as an app (the browser's "Install", or "Add to home screen" on a phone): an app icon, the site's name, and its background color for the window's bars. Pages aren't kept for offline use, so nothing decrypted stays on the device

### Fixed

- On an iPhone or iPad, a page in the left pane opened only on the second tap (the first one showed the row's "+" button). On touch screens that button is now always shown

### Security

- Mermaid 12.3.0, with KaTeX 0.18 (a prototype pollution that could get past KaTeX's trust setting). `pnpm audit --prod` finds nothing

## [0.1.2] - 2026-11-05

### Added

- Chat blocks: replies (the message replied to is quoted above, and a click on the quote shows it), mentions ("@" offers the people who can open the page; they're notified of the mention), links for the URLs in messages, and the messages' text can be selected and copied
- Chat blocks can be locked by anyone who can edit the page: no new messages, and messages can't be changed or taken back, until it's unlocked
- Code blocks: "Format" at the top right, with the indent to use (2 or 4 spaces, or a tab; remembered in the browser). JavaScript, TypeScript, JSON, CSS, HTML, Vue, Markdown, YAML and GraphQL are formatted with Prettier, SQL with sql-formatter; other languages have their indentation changed to the one chosen
- Child page tables: a "Masked text" column type. Its values are encrypted in the browser with the column's passphrase (chosen with the first value), so the server only ever has the encrypted form; "Show" in the column's header asks for the passphrase
- Child page boards: sub-groups, a board per value of a second column (a select or a user column), one under another; a card moves to another sub-group with its own picker
- The ⋮⋮ menu: "Copy" (to the clipboard: pasted into a page, the blocks come back as they were) and "Duplicate"
- Code blocks: a preview of HTML (with its CSS and JavaScript), Markdown, Mermaid and LaTeX code, below the code or in its place (chosen by an editor, shown to everyone). HTML and Markdown are shown in a sandboxed frame that can't reach the page, the site or the network
- Extended tables: a table whose cells hold any blocks (paragraphs, lists, images, code…), with a header row and row titles. Rows and columns are added and deleted from the bar above the table or a cell's menu, and columns are made wider by dragging their edge. Exported as a table of the cells' text
- Block locks, from the ⋮⋮ menu: "Can't be deleted" (the block can still be edited and moved) or "Content can't be changed" (nor deleted; the blocks nested in it included). Anyone who can edit the page can lock and unlock (loosening asks first); a label beside the block shows the lock. Like page locks, they prevent mistakes and aren't access control. Through the API, a page with locked blocks can't have its body replaced (`blocks_locked`, 423)
- Search engines (once allowed in the admin console): /robots.txt points to /sitemap.xml, which lists the public pages; a public page has a description (the start of its text), its canonical URL, Open Graph and Twitter card tags, and structured data (an article)

### Changed

- Code blocks list their languages A to Z (plain text first)
- Every screen's title, and the app's name when added to the home screen, end with the site's name (the one at the top left) instead of "KNOWLECTIVE"
- A screen opened before the app was updated can no longer edit pages: it's asked to reload instead (an editor that doesn't know a new kind of block would remove it from the page for everyone, and one that doesn't know block locks would ignore them)

### Fixed

- Enter in the title of a toggle (or a toggle heading) with blocks inside moved those blocks out, into a new toggle below. They now stay: an open toggle continues with a new first block inside, a closed one with a new toggle below
- Deleting the block of one of three columns, while another column was empty, turned the layout into a single column. It now keeps two

### Upgrade notes

- Two database migrations (chat replies and locks, the masked column type), applied on start as usual
- Screens left open over the update can't connect to the pages any more and ask to be reloaded (their edits not yet saved are lost on reload). This also applies to screens of the previous version, which only say the page couldn't be opened

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
