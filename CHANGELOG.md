# Changelog

Notable changes to KNOWLECTIVE, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/), and versions follow [Semantic Versioning](https://semver.org/).

Until 1.0.0, a MINOR version (0.**x**.0) may contain changes that need attention when updating; they're listed under **Upgrade notes**. From 1.0.0 on, those come only with a MAJOR version: removed or renamed environment variables, database migrations that need manual steps, incompatible changes to `/api/v1`, and higher minimum Node.js or PostgreSQL versions.

Add each change under "Unreleased" as it's made. `pnpm release <version>` turns that section into the release's.

## [Unreleased]

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
