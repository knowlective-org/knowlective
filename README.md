# yosuga

ブロックエディタとリアルタイム共同編集を備えた、セルフホスト可能なドキュメント・ナレッジ共有OSS（フルスクラッチ）。

## 名前の由来

「よすが（縁・因・便）」は、頼りとするもの・手がかり・ゆかりを意味する日本語。
チームの知識や記録が集まり、あとから辿るときの手がかりになる場所でありたい、
という思いを込めている。

## 構成

- `apps/web` — Next.js。画面 + APIルート（ページCRUD / workspace / 認証 / 権限）
- `apps/collab` — Hocuspocus（Yjs WebSocket同期サーバー）専用プロセス
- `packages/shared` — Prismaスキーマ・型定義の共有パッケージ

エディタは [BlockNote](https://www.blocknotejs.org/)（Tiptap/ProseMirrorベース）、
共同編集は [Yjs](https://github.com/yjs/yjs) + [Hocuspocus](https://tiptap.dev/docs/hocuspocus)、
DBはPostgreSQL、水平スケール用にRedis pub/subを使用。

## セットアップ

```bash
cp .env.example .env
pnpm gen:server-key        # 出力された値を .env の YOSUGA_SERVER_KEY に設定
docker compose up -d      # Postgres + Redis
pnpm install
pnpm db:migrate            # packages/shared の Prisma マイグレーション
pnpm db:seed                # デモ用 workspace/page ("demo") を作成
```

> Next.js は自分のディレクトリ（`apps/web`）の `.env*` しか読まないため、
> ルートの `.env` とは別に `apps/web/.env.local` にも同じ値を置いている。
> 値を変更したときは両方更新すること。

## 初回セットアップと暗号化

初めてアクセスすると `/setup` に移動し、マスターパスワードとサイトの公開 URL を設定する。公開 URL はメールや招待リンクに使われ、あとから管理画面の「サイトの設定」で変更できる。
このとき、ページ内容を暗号化するための鍵（データ鍵）が生成される。

- データ鍵は平文では保存せず、次の2通りで暗号化して DB に保存する（エンベロープ暗号化）。
  - マスターパスワードから導出した鍵（scrypt）で暗号化したもの … 復旧・鍵の入れ替え用
  - サーバーの鍵 `YOSUGA_SERVER_KEY` で暗号化したもの … 起動時に自動で鍵を取り出す用
- ページ本文（Yjs の状態）は AES-256-GCM で暗号化して保存する。DB やバックアップだけが漏れても内容は読めない。
- `YOSUGA_SERVER_KEY` を失った・漏れた・入れ替えたいときは、マスターパスワードを使って新しいサーバー鍵を発行できる。

  ```bash
  pnpm rotate-server-key
  ```

> **`YOSUGA_SERVER_KEY` とマスターパスワードを両方失うと、ページのデータは復旧できない。**
> どちらも安全な場所に保管すること。

## ユーザーとログイン

アカウントは招待制。管理画面（`/admin`）の「ユーザーの招待」で招待リンクを発行し、相手に渡す。

- 招待先は既存のワークスペース（権限: 管理者 / メンバー / ゲスト）か、新しいワークスペース（招待された人がオーナー）を選べる
- 招待リンクは7日間有効・1回限り。発行時に一度だけ表示される
- ログインはメールアドレス＋パスワード。同じ接続元またはメールアドレスで15分以内に10回失敗するとロックする
- ページはワークスペースのメンバーだけが開ける。ゲストは閲覧のみ

## 管理画面（`/admin`）

管理画面は「概要・ユーザー・グループ・セキュリティ」の4ページ。ログイン方法は2通りで、どちらも認証アプリ（TOTP）が必須。初回ログイン時に認証アプリを登録する。

- **アカウントでログイン（通常）:** 組み込みグループ「サイト管理者」のメンバーが、自分のメールアドレス＋パスワード＋認証アプリで入る。グループから外すと、ログイン中でもすぐに入れなくなる
- **マスターパスワードでログイン（初期設定・復旧用）:** `/admin/login?mode=master`。最初のサイト管理者を登録するときや、管理者全員が入れなくなったときに使う

最初の手順: マスターパスワードでログイン →「ユーザー」で自分を招待して登録 →「グループ」→「サイト管理者」に自分を追加 → 以降はアカウントでログイン。

グループは「グループ」ページで作成・名前変更・削除・メンバー管理ができる（組み込みの「サイト管理者」は削除できない。自分自身はサイト管理者から外せない）。

- **ログイン:** マスターパスワード ＋ 認証アプリの6桁のコード
- **回数制限:** 同じ接続元から15分以内に5回失敗すると、その接続元をロックする
- **セッション:** 通常ユーザーとは別。操作がないまま30分、またはログインから12時間で切れる
- **IP 制限:** 管理画面で許可する IP アドレス・CIDR を設定できる。許可されていない接続元には 404 を返す

### メール送信

管理画面の「メール送信」で SMTP サーバーを設定する。保存後に「テストメールを送信」で確認できる。

- 項目: 送信元メールアドレス、送信者名、SMTP サーバー、ポート、暗号化（STARTTLS / SSL/TLS / なし）、SMTP AUTH（ユーザー名・パスワード）
- STARTTLS を選んだ場合、サーバーが STARTTLS に対応していなければ送信しない（暗号化なしに切り替えて送ることはしない）
- 暗号化「なし」と SMTP AUTH は同時に使えない（パスワードが平文で流れるため）
- SMTP のパスワードはデータ鍵で暗号化して保存し、画面には表示しない。空欄のまま保存すると、保存済みのパスワードをそのまま使う

管理画面に入れなくなったときは、サーバー上でマスターパスワードを使って復旧する。

```bash
pnpm admin:recover --reset-totp          # マスターパスワード用の認証アプリをなくした（次回ログインで再登録）
pnpm admin:recover --reset-user-totp=<メールアドレス>  # サイト管理者が認証アプリをなくした
pnpm admin:recover --clear-ip-allowlist  # IP 制限で締め出された
pnpm admin:recover --clear-lockout       # ログイン失敗のロックを解除
```

### 本番運用の前提（リバースプロキシ）

接続元 IP は `X-Forwarded-For` から判定するため、**Next.js を直接インターネットに公開せず、必ずリバースプロキシ（Caddy / nginx など）の後ろに置くこと。** 直接公開すると IP を偽装でき、回数制限と IP 制限が効かなくなる。

- プロキシは `X-Forwarded-For` に接続元を**追記**し、`X-Forwarded-Proto` を渡すこと（nginx なら `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` と `proxy_set_header X-Forwarded-Proto $scheme;`）。`X-Forwarded-Proto: https` が届かないと、管理画面の Cookie に Secure が付かない。
- プロキシが2段以上（例: CDN → nginx）なら、`YOSUGA_TRUSTED_PROXY_HOPS` にその段数を設定する。

## 開発

```bash
pnpm dev:web       # http://localhost:3000
pnpm dev:collab    # ws://localhost:1234
```
