# AGENTS.md

ブロックエディタとリアルタイム共同編集を備えた、セルフホスト可能なドキュメント・ナレッジ共有OSS（フルスクラッチ）。このファイルは、AIエージェントや新しく参加する開発者向けの引き継ぎ資料。

## 構成

pnpmモノレポ。

| パス | 役割 |
|---|---|
| `apps/web` | Next.js 16（App Router / Turbopack）。画面と、今後追加するAPIルート（ページCRUD・ナレッジルート・認証・権限） |
| `packages/shared` | Prismaスキーマ、`createPrismaClient()`、シードスクリプト |

- エディタ: BlockNote（Tiptap/ProseMirrorベース）
- 共同編集: Yjs（CRDT）+ Hocuspocus
- DB: PostgreSQL（メタデータ + Yjs状態のバイト列）
- 配布: Docker Composeでのセルフホストを前提とする

## 技術選定の経緯（再提案しないこと）

- 既存OSS（Docmost / AFFiNE / Outline）をforkせず、**フルスクラッチ**で作る。
- バックエンドはNestJSではなく**Next.jsに統合**（APIルート）。
- YjsのWebSocketサーバー（Hocuspocus）は、Next.jsの**カスタムサーバー**（`apps/web/server/`）で同じプロセス・同じポートの `/collab` に載せている。Next.jsのRoute Handlersでは WebSocket が動かない（同梱ドキュメントに明記）ため。以前は別プロセス（`apps/collab`）だったが、1プロセスに統合済み。
- Ruby/Python等への言語変更は検討済みで、見送り。理由は、エディタがJS資産であること、サーバー側でドキュメントの中身を読む処理（検索・エクスポート）に `yDocToBlocks` 等のTS資産が必要になること。
- 将来ホワイトボード/図の機能を足す場合は、カスタムブロック + 図ごとのYjsサブドキュメントで検討する（未着手）。

## セットアップ

```bash
npm install -g pnpm        # 未インストールの場合（ユーザー自身のターミナルで実行）
cp .env.example .env
pnpm gen:server-key        # 出力を .env と apps/web/.env.local の YOSUGA_SERVER_KEY に設定
docker compose up -d       # Postgres + Redis
pnpm install
pnpm db:migrate
pnpm db:seed               # デモ用 Page(id="demo") を作成。collabの動作確認に必須
```

Next.jsは自分のディレクトリの `.env*` しか読まない。ルートの `.env` とは別に、`apps/web/.env.local` にも同じ値を置く（`DATABASE_URL`、`REDIS_URL`、`YOSUGA_SERVER_KEY`）。値を変えたら両方更新する。

## 開発

```bash
pnpm dev           # http://localhost:3000（PORT で変更。共同編集は同じポートの /collab）
```

デモ: `/admin` で「Demo 管理」グループに入る招待リンクを発行して自分を登録し、`/pages/demo` を2つのタブで開く。片方で入力するともう片方に反映される（ページは権限のあるグループのメンバーしか開けない）。

## 実装上の注意（ハマりどころ）

初期スキャフォールド時、記憶していた各パッケージのAPIはほぼ全て古かった。**新しい依存を使う前に、インストール済みの型定義・同梱ドキュメントを読んで確認すること。**

- **Prisma 7**
  - Rustクエリエンジンが廃止され、`PrismaClient` にはドライバアダプタ（`@prisma/adapter-pg` + `pg`）が必須。
  - 接続URLは `schema.prisma` ではなく `packages/shared/prisma.config.ts` に書く。
  - `new PrismaClient()` を直接使わず、`packages/shared/src/index.ts` の `createPrismaClient()` を使う。
  - `Bytes` 型には `Buffer` を直接渡せない。`Uint8Array.from(buf)` で変換する（`apps/web/server/collab.ts` 参照）。
- **@hocuspocus/server 4.x**: `Server.configure({...})` は廃止。`new Server({...})` を使う。
- **BlockNote 0.5x の共同編集**: `@blocknote/core/yjs` の `withCollaboration()` で、`useCreateBlockNote` に渡すオプションを包む。`apps/web` に `y-prosemirror` と `y-protocols` を明示的に入れる必要がある。
- **Next.js 16**: `'use client'` のコンポーネントも初回HTMLのためにサーバー側でレンダリングされる。BlockNote/Hocuspocusは `window` を触るため、エディタは `next/dynamic(..., { ssr: false })` で読み込む（`apps/web/src/app/pages/[pageId]/page.tsx`）。`params` などは非同期APIになっている。詳細は `apps/web/node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md` も参照）。
- **pnpm 11**: ビルドスクリプトはデフォルトでブロックされる。`pnpm-workspace.yaml` の `allowBuilds` で、`@prisma/client`・`@prisma/engines`・`esbuild`・`prisma`・`unrs-resolver` を許可している。新しいネイティブ依存を足したら、同様に許可が必要。
- **外部キー制約**: `PageDocument.pageId` は `Page.id` への外部キー。`Page` 行が存在しないドキュメントは、collabサーバーがPostgresに保存できない（エラーログが出て、ドキュメントはメモリに残るだけ）。ページ作成APIを作るときは、エディタを開く前に `Page` を作成すること。
- **初回セットアップと暗号化**: `InstanceConfig`（id=1 の1行だけ）がない間は、`apps/web/src/app/(app)/layout.tsx` が全画面を `/setup` に飛ばし、collab は接続を拒否する。データ鍵（DEK）はマスターパスワード由来の鍵と `YOSUGA_SERVER_KEY` の2通りで暗号化して保存する（`packages/shared/src/instance.ts`）。`PageDocument.state` は DEK で暗号化され、pageId を AAD に入れている（別ページの行にコピーしても復号できない）。暗号化前の古いデータは復号できないため、DBを作り直すこと。
- **Next.js 16 の事前レンダリング**: DB を読む Server Component では先に `await connection()` を呼ぶ。呼ばないとビルド時に事前レンダリングされてしまう。
- **shared の import**: `packages/shared` 内の相対 import は拡張子なしで書く。`.js` を付けると Turbopack が解決できない。
- **管理画面（`/admin`）の認証**: `apps/web/src/lib/admin/auth.ts`。**管理画面のページと Server Action は、それぞれの中で `requireAdmin()` を呼ぶこと。** layout は守りにならない（Server Action は layout を通らずに直接 POST される）。ログイン画面と認証アプリの登録画面は、IP 制限・セッションの段階を個別に確認している。
- **ユーザーの無効化**: `User.disabledAt`。無効化するとセッション（通常・管理画面）をすべて削除したうえで、`getCurrentUser()`・`isSiteAdmin()`・collab の `onAuthenticate` でも個別に弾く（どれか1つが漏れても入れないように）。所属は残すので、有効に戻せば元どおり。新しく「ユーザーで認証する入口」を作るときは、`disabledAt` の確認を必ず入れる。
- **ロールとグループ**: サイト全体の権限は `User.siteRole`（SITE_ADMIN / CONTENT_MANAGER / USER、`apps/web/src/lib/roles.ts`）。グループ（`Group` / `GroupMember`）はページツリーの権限を付けるためだけのもので、ロールをグループで表さない（旧「サイト管理者」グループは廃止）。ページを見られるかどうかはロールで決めない（SITE_ADMIN でも権限がなければ見られない）。管理画面のページと Server Action は `requireAdmin(許可するロール)` を呼ぶ（既定は両方。設定まわりは `["SITE_ADMIN"]`）。マスターパスワードでのログイン（`AdminSession.userId` が null）は SITE_ADMIN 扱い。`requireAdmin()` は毎回ロールと無効化を確認し直す。コンテンツ管理者が招待できるのは CONTENT_MANAGER / USER だけ（`invitableRoles()`）。最後の有効な SITE_ADMIN は降格・無効化できない。ユーザーごとの TOTP 秘密鍵は `User.totpSecret`（AAD にユーザー id を含めて暗号化）。
- **管理画面のページ構成**: `apps/web/src/app/admin/(console)/` の layout はナビゲーションだけで、守りは各ページと Server Action の `requireAdmin()`。更新後は `revalidatePath("/admin", "layout")` で管理画面全体を再検証する。
- **接続元 IP**: Next.js は `X-Forwarded-For` が無いときしか接続元を入れない（`??=`）。そのため右から `YOSUGA_TRUSTED_PROXY_HOPS` 番目を採用している（`apps/web/src/lib/admin/ip.ts`）。リバースプロキシなしで公開すると偽装できる。
- **ナレッジルート**（旧ワークスペース。画面上の名前は「ナレッジルート」）: DB では入れ物 `KnowledgeRoot` と、そのルートページを別々に持ち、画面上はルートページがナレッジルートとして見える。名前はルートページのタイトルで、入れ物には名前を持たせない。`KnowledgeRoot.rootPageId` と `Page.rootId` が互いを参照するので、作成は必ず `createKnowledgeRoot()`（`packages/shared`）でトランザクション内で行う。`rootPageId` は DB 上は任意だが常にセットされ、ルートページは `ON DELETE RESTRICT` で削除できない。`parentId` が null なのはルートページだけ。すべてのページが `rootId` を持つので、権限の判定はナレッジルート1つ分の木を1回読めば済む（別のルートへ移動するときは配下もまとめて付け替える）。ページの階層の上限は `MAX_PAGE_DEPTH`（50、`packages/shared`）。ページの作成・移動の処理を作るときは、上限と循環（自分や配下を親にしない）の確認を入れる。
- **ページタイトル**: タイトルは Yjs ドキュメントの `Y.Text("title")`（本文の BlockNote と同じドキュメント）に持ち、共同編集でその場で同期する。collab サーバーが保存時に `Page.title` へ書き戻す（サイドバー・ホーム・ナレッジルート名は DB の値を読む）。まだタイトルを持たないドキュメントは、読み込み時にサーバー側で `Page.title` から1回だけ入れる（クライアントが入れると、同時に開いた人の分だけ重複するため）。定数は `apps/web/src/lib/page-title.ts`（ブラウザと collab の両方から読むので依存を入れない）。
- **ページ画面**: `(app)/pages/[pageId]/page-view.tsx` が、左のドキュメントツリー（`position: sticky`）と右のタイトル＋エディタを並べる。ページごとに `key={pageId}` で作り直し、エディタはアンマウント時に共同編集の接続を閉じる。
- **ファイル添付**: `apps/web/src/lib/storage.ts`（S3 互換。`@aws-sdk/client-s3`、チェックサムは互換性のため必要なときだけ）。保存先は `StorageSettings`（id=1 の1行だけ）、なければ同梱の SeaweedFS（`SEAWEEDFS_*` 環境変数）。ファイルの中身はデータ鍵で暗号化（AAD はファイル id）。アップロードは `POST /api/files?pageId=`、配信は `GET /api/files/<id>`（Route Handler なので CSRF は自前で Origin を確認）。配信時は `INLINE_TYPES` 以外を必ず `attachment` + `application/octet-stream` にする（HTML・SVG をアプリのオリジンで実行させないため）。今はファイル全体をメモリに載せて暗号化するので、上限は `MAX_FILE_SIZE_MB_LIMIT`（500MB）。ページからブロックを消してもファイルは消えない（後で掃除の仕組みが必要）。MinIO は公式イメージの配布が止まったため使っていない。
- **開発サーバーの動作中に `next build` を実行しないこと。** `.next` を作り直すので、動いている開発サーバーが使う `.next/dev` まで消え、全ページが 500 になる（`server/` のファイルを保存して再起動すれば直る）。型の確認は `tsc --noEmit` で行う。
- **ページの権限**: `packages/shared/src/permissions.ts`。権限は必ずグループ経由（`PageGrant`：ページ × グループ × 閲覧/編集/管理）。個人やサイトのロールには付けない。同じグループは親へたどって最初の付与が効き（下位で絞れる）、複数グループは最も強いものが効く。判定は `getPageAccess()`、一覧は `getVisibleTrees()` / `getVisibleTree()`（親が見えない「入口」のページは `entryIds`）。web・collab・ファイル配信は必ずこれを使う。見えない親のタイトルやナレッジルート名を、子だけ見える人に出さないこと。
- **ユーザー認証**: 招待制。`apps/web/src/lib/auth/`（`session.ts` / `invitations.ts` / `pages.ts`）。ページと Server Action はそれぞれ `requireUser()` を呼ぶこと（`(app)/layout.tsx` はセットアップ済みかを見るだけ）。ページを開く権限は `findAccessiblePage()` で判定し、権限がなければ 404 にする。
- **公開 URL**: メールや招待リンクなど、サイトの外に出るリンクは必ず `getPublicUrl()`（`apps/web/src/lib/site-url.ts`）で組み立てる。Host ヘッダーはクライアントが自由に変えられるので、リクエストから組み立てない（`getRequestOrigin()` は入力欄の初期値と、未設定のときの代わりにだけ使う）。
- **メール送信**: `apps/web/src/lib/mail.ts`（nodemailer 10。型は本体に同梱されているので `@types/nodemailer` は入れない）。設定は `MailSettings`（id=1 の1行だけ）、SMTP パスワードはデータ鍵で暗号化。送信は `sendMail()`、未設定なら `MailNotConfiguredError`。
- **カスタムサーバー**（`apps/web/server/`）: `index.ts` が Next.js と共同編集を1つの HTTP サーバーで動かす。`env.ts` を必ず最初に import する（NODE_ENV と .env の読み込み）。`collab.ts` は Next.js にバンドルされないので、アプリ側（`src/lib/db.ts`）とは別の PrismaClient を持つ。Next.js は最初のリクエストで自前の upgrade リスナーを付け、開発時のホットリロード（`/_next/`）だけを処理し、ルートに一致しないパスの WebSocket には触らない。**`/collab` にページやルートを作らないこと**（作ると Next.js がその接続を切る）。tsx で動かすのは、`packages/shared` を TypeScript のまま使っているため。開発モードの Next.js は同じフォルダで2つ起動できない（2つ目はエラーで終了する）。
- **collabの認証**: エディタは接続のたびに Server Action `getCollabToken()` で5分有効の署名付きトークン（ユーザー＋ページ）を受け取る。署名鍵は `YOSUGA_SERVER_KEY` から HKDF で導出（`packages/shared/src/collab-token.ts`）。collab の `onAuthenticate` は署名・期限・ページ一致を確認したうえで、DB でページの権限を再確認する。閲覧のみなら読み取り専用。

## 現在の状況

完了:
- モノレポ構成、Prismaスキーマ（User / KnowledgeRoot / Page / PageGrant / Group ほか）、Docker Compose
- BlockNote + Yjs + Hocuspocus のエンドツーエンド疎通（ブラウザとNodeクライアントの双方で、編集がCRDTでマージされPostgresに保存されることを確認済み）
- `pnpm build`（web / shared）が通る
- 初回アクセス時のマスターパスワード設定と、データ鍵の生成・ページ本文の暗号化（`/setup`、`pnpm rotate-server-key`）
- ユーザーのログイン（招待制）、collab の認証（署名付きトークン＋ページ権限の確認、閲覧のみは読み取り専用）
- メール送信の設定（SMTP）とテスト送信（`/admin`）
- サイト全体のグループと、組み込みの「サイト管理者」グループ（自分のアカウント＋TOTP で /admin に入れる）
- 管理画面 `/admin`: マスターパスワード＋TOTP、ログイン回数制限、管理画面専用セッション、IP 制限、復旧コマンド `pnpm admin:recover`

未着手（次の候補）:
- ページ作成・一覧・階層のCRUD APIルート（`apps/web`）
- パスワードの再設定（メール送信は実装済み。再設定メールの送信と、メール未設定時に管理画面から再設定リンクを発行する手段）
- ナレッジルートの作成画面、ページの「共有」（グループ権限の設定）画面、コンテンツ管理者のグループ編集の制限、権限変更の記録（計画の3段階目）
- ページの作成・一覧・階層の CRUD
- ナレッジルートの権限モデル
- 添付ファイルの掃除（ブロックを消したファイルの削除）と、大きいファイル向けのストリーミング暗号化
- 全文検索（まずはPostgres全文検索）。ページ本文は暗号化されているため、DB側の全文検索ではなく、復号してから検索用の索引を作る設計が必要
- 本番用のDockerイメージ（1つのイメージで足りる）
