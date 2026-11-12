# Security policy

[日本語は下にあります](#日本語)

## Reporting a vulnerability

**Please don't report security vulnerabilities in public issues, pull requests or discussions.**

Report them privately through GitHub: on this repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/knowlective-org/knowlective/security/advisories/new)). Only the maintainers can see the report.

Please include what you can of:

- The affected version (shown in the admin console under "バージョン情報" / About, or the release or commit you built)
- Where it is (file and line, route, Server Action, or screen)
- What an attacker needs first (not logged in, a user with view access, a content manager, a site admin, a particular setting)
- Steps to reproduce, against your own instance
- What it lets an attacker do

A short report is fine: we'd rather hear about a possible problem than not.

## What to expect

- We aim to acknowledge a report within a week, and to tell you whether we consider it a vulnerability once we have reproduced it.
- Fixes are released as a new version. The advisory is published when the fix is available, with a CVE where it applies.
- We credit reporters in the advisory unless you'd rather not be named.
- This is a small project with no bug bounty.

## Supported versions

Until 1.0.0, only the latest release gets security fixes. Please update to it before reporting, if you can.

## Testing

Test only against an instance you run yourself (see the README's setup). Don't test against instances you don't own, including app.knowlective.org, and don't run load or denial-of-service tests against anyone's instance.

## In scope

Anything in this repository: the web app and its custom server (collaborative editing), the shared package, the Docker image, `docker-compose.prod.yml` and `install.sh`. For example:

- Opening, changing or finding out about pages (including their titles), files or people without the access to
- Getting past login, two-factor authentication, passkeys, single sign-on, or the admin console's IP allowlist
- Script running on the app's origin (stored or reflected XSS), and anything in a shared document that runs or loads where it shouldn't
- Making the server connect to addresses it shouldn't (SSRF)
- Reading data that is meant to be stored encrypted (page content, history, attachments, email addresses, the audit log) without the keys
- Running commands or reading files on the server

## Out of scope

- Vulnerabilities in dependencies that don't affect KNOWLECTIVE as it uses them (please report those upstream)
- Setups that go against the documentation, such as exposing the app without the reverse proxy that `KNOWLECTIVE_TRUSTED_PROXY_HOPS` describes, exposing the database, Redis or storage ports to the internet, or using the end-to-end test accounts (whose passwords are public in this repository) outside development
- Anything that needs a site admin to act against their own instance (site admins are trusted with the server's settings), unless it reaches past what the admin console is meant to allow: site admins aren't meant to read pages they have no access to
- Missing headers or settings without a way to exploit them (they are welcome as ordinary issues)
- Social engineering and physical attacks

## For administrators

Some protections depend on how an instance is run:

- Put the app behind a reverse proxy that sets `X-Forwarded-For`, and set `KNOWLECTIVE_TRUSTED_PROXY_HOPS` to match. Without one, the client address can be forged, which weakens the IP allowlist, rate limits and network-based access.
- Serve it over HTTPS, and set HSTS at the reverse proxy.
- Keep `KNOWLECTIVE_SERVER_KEY` secret, and keep the master password somewhere safe: together they protect the data key. The bundled PostgreSQL's encryption keys (the `postgres_tde_keys` volume) are needed to start the database.
- Never run the end-to-end seed (`pnpm e2e:seed`) against a production database.
- Keep the instance updated.

---

## 日本語

**脆弱性は、公開の Issue・プルリクエスト・Discussions に書かないでください。**

GitHub の非公開の報告で知らせてください。このリポジトリの **Security** タブの **Report a vulnerability**（[直接のリンク](https://github.com/knowlective-org/knowlective/security/advisories/new)）から送れます。報告はメンテナーにしか見えません。

分かる範囲で、影響するバージョン・場所・前提（ログインなし／閲覧の権限のある利用者／管理者など）・再現の手順・影響を書いてください。短い報告でもかまいません。

- 1週間以内をめどに受け取りを返信し、再現できたら脆弱性として扱うかをお知らせします。
- 修正は新しいバージョンとして出し、そのときにアドバイザリを公開します。報告者のお名前は、希望がなければアドバイザリに記載します。報奨金の制度はありません。
- 1.0.0 までは、最新のリリースだけを修正の対象とします。
- 試すのは、ご自分で立てた環境だけにしてください。app.knowlective.org を含め、ほかの人の環境では試さず、負荷をかける試験もしないでください。
- 対象・対象外、運用する方への注意は、上の英語の節を見てください。
