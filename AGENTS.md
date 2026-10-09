# AGENTS.md

ブロックエディタとリアルタイム共同編集を備えた、セルフホスト可能なドキュメント・ナレッジ共有OSS（フルスクラッチ）。このファイルは、AIエージェントや新しく参加する開発者向けの引き継ぎ資料。

## 構成

pnpmモノレポ。

| パス | 役割 |
|---|---|
| `apps/web` | Next.js 16（App Router / Turbopack）。画面・Server Action・Route Handler と、共同編集（Hocuspocus）を載せたカスタムサーバー（`server/`） |
| `packages/shared` | Prismaスキーマ、`createPrismaClient()`、シードスクリプト |

- エディタ: BlockNote（Tiptap/ProseMirrorベース）
- 共同編集: Yjs（CRDT）+ Hocuspocus
- DB: PostgreSQL（メタデータ + Yjs状態のバイト列）
- 配布: Docker Composeでのセルフホストを前提とする（本番は `Dockerfile` ＋ `docker-compose.prod.yml`。`docker-compose.yml` は開発用の依存サービスだけ）

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

### UI 要素の名前（`data-ui` 属性）

画面の要素を名前で指示・特定できるように、**機能のある DOM 要素には必ず `data-ui` 属性で名前を付ける。** 新しく作る・変更するコンポーネントでも守ること。

```tsx
<div data-ui="DocTree">
  <button data-ui="DocTree.toggle">▸</button>
  <a data-ui="DocTree.link" data-id={node.id}>…</a>
</div>
```

- **コンポーネントのルート要素**: コンポーネント名（関数名と同じ PascalCase）。例: `data-ui="DocTree"`。ページ（`page.tsx`）や layout はその関数名（`AdminUsersPage` など）を使う。
- **機能のある要素**: `コンポーネント名.要素名`（要素名は camelCase）。例: `DocTree.toggle`、`LoginForm.submitButton`。
- **対象**: ボタン、リンク、入力欄（input / select / textarea）、フォーム、メニュー・メニュー項目、トグル、エラーやステータスの表示、ツリー・一覧の行など、操作できるものや状態を表示するもの。レイアウトだけの div や単なる見出し・文章には付けない。
- **繰り返す要素**（一覧の行など）は同じ名前にし、区別が必要なら `data-id` に id を入れる。
- **名前はページ内で一意でなくてよいが、同じコンポーネントの中では一意にする。** 子コンポーネントの中の要素は、子コンポーネントの名前で付ける（親の名前を付け足さない）。
- 名前は機能を表す（`submitButton`、`deleteMenuItem` など）。見た目（`blueButton`）や文言で付けない。
- 末尾は要素の種類に揃える: `〜Button` / `〜Link` / `〜Input` / `〜Select` / `〜Checkbox` / `〜Radio` / `〜Form` / `〜Row`（一覧の行）/ `〜Item`（ツリー・メニューの項目）。エラー表示は `error`（種類があれば `〜Error`）、成功・進行中などの表示は `status`。
- Fragment を返すページなど、ルートの DOM 要素がないコンポーネントにはルートの名前を付けなくてよい。
- BlockNote など外部ライブラリが描画する内部の DOM は対象外。自分で書いたコンポーネント（ラッパーやカスタムブロック）にだけ付ける。
- 将来 Playwright を入れるときは `testIdAttribute: "data-ui"` を設定し、`getByTestId("LoginForm.submitButton")` で同じ名前を使う。

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
- **ページ画面**: `(app)/pages/[pageId]/page-view.tsx` が、`AppShell`（左に sticky のサイドバー）の中にタイトル＋エディタを置く。サイドバー（`components/sidebar.tsx`、データは `lib/sidebar-data.ts`）は見られるナレッジルートをすべて並べる。`/` は専用画面を持たず、`User.lastPageId`（ページを開くたびに更新）か最初に見えるページへリダイレクトする。アプリの全ページに `RefreshOnReturn` があり、タブに戻ったときや戻る／進むで `router.refresh()` する（ロールや権限の変更をログインし直さずに反映するため）。ページごとに `key={pageId}` で作り直し、エディタはアンマウント時に共同編集の接続を閉じる。
- **画面の構成**: ログイン後のアプリ画面（`(app)` 配下：ページ・共有・新しいナレッジルートなど）は、すべて `AppShell` ＋ `Sidebar`（`loadSidebar()`）の2ペインにし、内容は右ペイン（`<main>`）に出す。右ペインの中身は `ui.module.css` の `.pane`（フォーム画面は `.paneNarrow`）で包み、`<main>` を自分で置かない。ログイン・招待・セットアップ・管理画面はこの対象外。
- **ファイル添付**: `apps/web/src/lib/storage.ts`（S3 互換。`@aws-sdk/client-s3`、チェックサムは互換性のため必要なときだけ）。保存先は `StorageSettings`（id=1 の1行だけ）、なければ同梱の SeaweedFS（`SEAWEEDFS_*` 環境変数）。ファイルの中身はデータ鍵で暗号化（AAD はファイル id）。アップロードは `POST /api/files?pageId=`、配信は `GET /api/files/<id>`（Route Handler なので CSRF は自前で Origin を確認）。配信時は `INLINE_TYPES` 以外を必ず `attachment` + `application/octet-stream` にする（HTML・SVG をアプリのオリジンで実行させないため）。今はファイル全体をメモリに載せて暗号化するので、上限は `MAX_FILE_SIZE_MB_LIMIT`（500MB）。ページからブロックを消してもファイルは消えない（後で掃除の仕組みが必要）。MinIO は公式イメージの配布が止まったため使っていない。
- **開発サーバーの動作中に `next build` を実行しないこと。** `.next` を作り直すので、動いている開発サーバーが使う `.next/dev` まで消え、全ページが 500 になる（`server/` のファイルを保存して再起動すれば直る）。型の確認は `tsc --noEmit` で行う。
- **ページの権限**: `packages/shared/src/permissions.ts`。権限は必ずグループ経由（`PageGrant`：ページ × グループ × 閲覧/編集/管理）。個人やサイトのロールには付けない。同じグループは親へたどって最初の付与が効き（下位で絞れる）、複数グループは最も強いものが効く。判定は `getPageAccess()`、一覧は `getVisibleTrees()` / `getVisibleTree()`（親が見えない「入口」のページは `entryIds`）。web・collab・ファイル配信は必ずこれを使う。見えない親のタイトルやナレッジルート名を、子だけ見える人に出さないこと。
- **組み込みグループ**: `Group.builtIn`。今は `all_users`（「全ユーザー」）だけで、GroupMember を持たず、有効なユーザー全員が暗黙のメンバー（`permissions.ts` の `userGroupIds()`）。削除・メンバー編集は拒否し、招待とナレッジルート作成（「管理」の付与先）の選択肢には出さない。
- **グループを扱える範囲**: `apps/web/src/lib/group-access.ts`。サイト管理者（とマスターパスワード）はすべて、コンテンツ管理者は「付いている権限がすべて自分が MANAGE を持つページにある」グループだけ。グループの画面・Server Action・招待・ナレッジルート作成のすべてで確認する（自分をグループに入れて見えないページを見る抜け道を防ぐため）。
- **変更の記録**: `AuditLog`（`apps/web/src/lib/audit.ts` の `recordAudit()`）。権限に関わる変更（ロール・有効/無効・グループのメンバーと名前・ページの権限・ナレッジルートの作成・招待）は必ず記録する。拒否した変更は記録しない。
- **見出しは H2〜H6**: ページタイトルが唯一の H1。`schema.tsx` の heading は `levels: [2..6]` だが型上の制約だけなので、貼り付け等で入った level 1 は `collaborative-editor.tsx` の demoteH1 で H2 にする（編集できる人の画面でだけ。リモート由来の変更は対象外）。外部からの貼り付け（`blocknote/html` 以外）は pasteHandler の shiftPastedHeadings で全見出しを1段下げる（H6 止まり）。H2 は既定レベルなので DOM に `data-level` が付かない。CSS で H2 を狙うときは `:not([data-level])` も含めること。
- **エディタのカスタムブロック**: スキーマは `apps/web/src/components/editor/schema.tsx`（スラッシュメニューの項目も）。ブロックの種類はページのドキュメントに保存されるので、**一度出したブロックの種類は削除・改名しないこと**（そのブロックを含むページが読めなくなる）。子ページ一覧（`childPages`）と子ページテーブル（`childTable`）は、ドキュメントには表示設定だけを持ち、中身は Server Action（`(app)/pages/[pageId]/child-pages-actions.ts`）で見ている人の権限で取得する。列の定義は `PagePropertyDef`（親ページに付く）、値は `PagePropertyValue`（子ページ × 列）で、列名・選択肢・値はデータ鍵で暗号化（`lib/page-properties.ts`）。
- **カスタムブロックで `<table>` を使わない**: BlockNote の表の拡張機能は、エディタ内でマウスの下にある `<td>` / `<th>` をすべて BlockNote の表ブロックの一部とみなし、そうでないブロックだと例外を出す（`Cannot read properties of undefined (reading 'rows')`）。子ページテーブルは div ＋ `display: table`（role 属性付き）で組んでいる。CSS Modules の `composes` も、composes したクラスをさらに composes すると効かないので1段にする。
- **子ページの変更通知**: Yjs の外にあるデータ（子ページのタイトル・更新日時・列の値）の変更は、`notifyChildrenChanged(親ページID)`（`lib/collab-events.ts`）で、親ページを開いている人に Hocuspocus の stateless メッセージを送る。中身は送らず、受け取ったブロックが自分の権限で取り直す。カスタムサーバーとNext.jsのバンドルは別モジュールなので、collab サーバーが `globalThis` に登録した橋渡しを使う。**子ページの作成・移動・削除、列や値を変える処理を足したら、必ずこれを呼ぶ。** `Page.updatedById` / `updatedAt` は collab の保存時（`onChange` で編集したユーザーを記録）とセルの変更時に更新する。
- **ダイアログ**: `window.alert` / `confirm` / `prompt` は使わない。`components/dialog.tsx` の `showAlert()` / `showConfirm()`（取り消しにくい操作は `danger: true`。ボタンが赤くなり、初期フォーカスが「キャンセル」になる）/ `showCopyText()` を `await` して使う（ルートの layout にある `<DialogHost />` が1つずつ表示する）。フォームの送信前に確認するときは `confirmBeforeSubmit()`（確認中もフォームが画面に残っている必要がある。メニューの中のフォームのように閉じるものは、確認後に Server Action を直接呼ぶ。`admin/(console)/row-menu.tsx` 参照）。独自のダイアログを作るときも `components/dialog.module.css` を使い、見た目を揃える。
- **色（テーマ）**: CSS では色を直接書かず、`globals.css` の CSS 変数（`--color-primary` など）を使う。管理画面で変えられる色は `lib/theme-tokens.ts` の `THEME_TOKENS`（DB は `ThemeSettings.colors` の JSON。項目を足してもマイグレーション不要）で、root layout が `<style id="yosuga-theme">` で上書きする。BlockNote の色は `globals.css` の `.bn-root` で変数に合わせている。
- **全文検索**: 索引は `PageSearchIndex.tokens`（BIGINT[]、GIN 索引）。`lib/search-index.ts` が、NFKC＋小文字にした本文・タイトル・添付ファイル名を1〜2文字の断片に区切り、データ鍵から HKDF で導出した検索用の鍵の HMAC 先頭64ビットにして保存する（平文は保存しない）。検索（`lib/search.ts`）は、クエリの断片をすべて含むページを `@>` で絞り込み、見られるページだけに限ってから、復号した本文で一致を確かめてスニペットを作る。索引の更新は collab の保存時・添付ファイルのアップロード時・ページ作成時で、起動時に `reindexStalePages()` で追いつく。ページの内容・タイトル・添付ファイルを変える処理を足したら `reindexPage()` を呼ぶこと。
- **ページの履歴**: `PageVersion`（Yjs の状態全体をデータ鍵で暗号化、AAD は `lib/page-versions.ts` の `versionAad()`）。版の保存は collab サーバー（`server/collab.ts`）だけが行う：保存時に前の版から `VERSION_INTERVAL_MS` 以上たっていれば、ドキュメントを閉じるとき（`beforeUnloadDocument`）は必ず、その間に編集した人（`onChange` の context）を記録して保存する。版がないページは読み込み時に `INITIAL` を保存する。復元は Server Action から橋渡しの `restoreVersion()` を呼び、collab の direct connection で本文とタイトルを差し替える（開いている人にもそのまま届く）。その前に `BEFORE_RESTORE`、後に `RESTORED` の版を保存する。ページの内容をサーバー側で書き換える処理を足すときは、同じように直前の版を残すこと。版は削除しない（監査）。機密情報のマスクは `lib/version-mask.ts`：版の Yjs 状態をそのまま編集せず、新しい Y.Doc に文字列を置き換えながら複製して作り直す（編集だと削除した文字が状態に残りうるため）。マスクした版は `maskedAt` が付き、復元を拒否する。マスク対象の文字列は保存もログ出力もしないこと。
- **削除とごみ箱**: 削除は `Page.deletedAt` / `deletedById` を付けるだけ（ページ単位。子孫は付けないが、木をたどるときに削除済みページを通らないので一緒に見えなくなる）。通常の判定（`getPageAccess` / `getVisibleTree(s)`）は削除済みを含まない。ごみ箱と復元・削除前の確認は `getTreeWithAccess()`（削除済みも含めた木と、削除がなかった場合の権限、生きているページの集合）と `getTrash()` を使う。削除には、対象と生きている子孫すべての EDIT が必要。復元は、親が生きていれば元の場所へ。親もごみ箱なら、同じナレッジルートの生きている EDIT 可能なページ（`restoreDestinations()`）の下へ移して戻し、権限が変わるので `page.restore.move` を変更の記録に残す。削除時は `closeDocuments()`（`lib/collab-events.ts`）で、開いている編集画面に `PAGE_DELETED` を送ってから切断する（Hocuspocus はそのドキュメントの通信だけを閉じ、プロバイダーは再接続しないので、通知しないと保存されないまま編集が続いてしまう）。ページを一覧・検索する処理を足すときは、削除済みを含めないこと。
- **ページの移動と並び順**: 並び順は `Page.sortOrder`（兄弟の中で昇順。同じ値は作成日時順）。木は必ず `PAGE_ORDER`（`packages/shared` の permissions.ts）の順で読むので、`getVisibleTree(s)` などの `pages` は兄弟順に並んでいる。ページを一覧する処理を足すときもこの順にすること。新しく親の下に置くページ（作成・別の親への復元）は `nextSortOrder()` で最後にする。移動は `lib/page-move.ts`：`planMove()` で確認（同じ親なら親の EDIT だけ、親を変えるならページと生きている子孫すべての EDIT ＋移動先の EDIT。循環・`MAX_PAGE_DEPTH`・ルートページ・古い `beforeId` を拒否）、`executeMove()` でトランザクション内に書き込み、移動先の兄弟を 0 から振り直す（削除済みの兄弟も含む）。別のナレッジルートへの移動では、ごみ箱にあるものも含めた子孫すべての `rootId` と、その添付ファイル（`FileObject.rootId`）を付け替える。`parentId`・`rootId`・`sortOrder` は SQL で書く（Prisma の `@updatedAt` で更新日時が変わるのを避けるため）。親を変えたら `page.move` を変更の記録に残し、`reconnectDocuments()` で開いている編集画面に `PAGE_MOVED` を送って切断する（エディタはつなぎ直して権限を確認し直し、画面を `router.refresh()` する）。Server Action は `(app)/page-move-actions.ts`、確認つきの実行はクライアントの `components/move-page.ts`（サイドバーのドラッグ＆ドロップとページメニューの「移動」の両方が使う）。
- **ページの共有**: `(app)/pages/[pageId]/share`。MANAGE を持つ人だけが変更でき、ルートページの MANAGE が0件になる変更は拒否する（サイト管理者もページを見られないので、誰も管理できないツリーになるため）。サイト管理者に見えるところ（グループの説明など）に、見えないページのタイトルを自動で書き込まないこと。
- **ユーザー認証**: 招待制。`apps/web/src/lib/auth/`（`session.ts` / `invitations.ts` / `pages.ts`）。ページと Server Action はそれぞれ `requireUser()` を呼ぶこと（`(app)/layout.tsx` はセットアップ済みかを見るだけ）。ページを開く権限は `findAccessiblePage()` で判定し、権限がなければ 404 にする。
- **ユーザーによる登録**: `lib/auth/signup.ts`。設定は `InstanceConfig.signupMode`（INVITE_ONLY / OPEN）・`signupAllowedDomains`・`signupSiteRole`（USER / CONTENT_MANAGER のみ）。OPEN でもメール送信が未設定なら無効（`getSignupSettings().enabled`）。`/signup` は `selfSignup: true` の `Invitation`（メールアドレス固定・24時間・グループなし）を作ってメールで送り、登録は通常の `/invite/<token>` で行う。登録時（`register()`）に設定・ドメインを確認し直し、ロールはその時点の設定を使う。登録済みのアドレスかどうかを画面で区別しないこと。管理画面の招待一覧には出さない。
- **パスワードの再設定**: `lib/auth/password-reset.ts`。`PasswordResetToken`（招待と同じくトークンのハッシュだけを保存、1回限り）。入口は2つ：`/forgot-password`（メールで送る。60分）と、管理画面のユーザー一覧「⋯」→ `/admin/users/<id>/password-reset`（サイト管理者のみ。画面に1回だけ表示し、任意でメール送信。24時間。メール未設定時の手段を兼ねる）。新しいリンクを発行すると、同じユーザーの未使用のリンクは `expiresAt` を今にして無効にする（行は回数制限のために残す）。`/forgot-password` は、アカウントの有無・無効化・SSO のみ・回数制限のどれでも同じ画面を返し、メールは待たずに送る（応答時間で区別させないため）。再設定（`completePasswordReset()`）はトランザクションでトークンを使用済みにし、無効化されていないことを確かめてからパスワードを変え、通常・管理画面のセッションをすべて削除する。自動ログインはせず `/login?reset=done` に戻す。リンクの発行（`user.password.reset.issue`）と再設定の完了（`user.password.reset`）は変更の記録に残す。
- **シングルサインオン（OpenID Connect）**: `lib/auth/oidc.ts`（プロトコルの処理は `openid-client` v6 に任せ、自前で JWT を検証しない）。設定は `OidcSettings`（id=1、クライアントシークレットはデータ鍵で暗号化）、IdP の利用者との対応は `User.oidcIssuer`＋`oidcSubject`（組で一意。初回ログインのコールバックで保存し、すでに別の sub がある既存アカウントへの結び付けは拒否）。表示名は `OidcSettings.nameClaim`（ID トークン→UserInfo の順、作成時のみ）。流れは `/auth/oidc/start`（state・nonce・PKCE をデータ鍵で暗号化した Cookie に入れて IdP へ）→ `/auth/oidc/callback`（`finishLogin()`：sub で結び付け済み → 確認済みメールで未結び付けの既存アカウント → ドメインが許可されていれば作成）。リダイレクト URI は必ず `getPublicUrl()` から作り、リダイレクトは相対パスで返す（プロキシの内側のホスト名を使わない）。ログイン画面のエラーは `?sso_error=<コード>` で、表示する文はコードから引く（URL の文字列をそのまま表示しない）。http の Issuer は localhost / 127.0.0.1 だけ許可（開発用）。パスワードログインの可否は `passwordLoginAllowed()`。
- **公開 URL**: メールや招待リンクなど、サイトの外に出るリンクは必ず `getPublicUrl()`（`apps/web/src/lib/site-url.ts`）で組み立てる。Host ヘッダーはクライアントが自由に変えられるので、リクエストから組み立てない（`getRequestOrigin()` は入力欄の初期値と、未設定のときの代わりにだけ使う）。
- **メール送信**: `apps/web/src/lib/mail.ts`（nodemailer 10。型は本体に同梱されているので `@types/nodemailer` は入れない）。設定は `MailSettings`（id=1 の1行だけ）、SMTP パスワードはデータ鍵で暗号化。送信は `sendMail()`、未設定なら `MailNotConfiguredError`。
- **本番用イメージ**（`Dockerfile`）: build ステージで全依存を入れて `next build`、runtime ステージは `pnpm install --prod` に `.next` と TypeScript のソース（`packages/shared`、`apps/web/server`・`src`）をコピーする（カスタムサーバーと shared を tsx で動かすため、Next.js の standalone 出力は使っていない）。`prisma`・`tsx`・`dotenv` は起動時のマイグレーションと復旧コマンドで使うので、shared の dependencies に入れている（devDependencies に戻さないこと）。起動は `docker-entrypoint.sh`：`prisma migrate deploy` のあと `node --import tsx server/index.ts --prod`（tsx の CLI だと子プロセスになり、SIGTERM が届かず開いているドキュメントを保存できない）。引数を付けるとそのコマンドを実行する。`node` ユーザーで動かす。稼働確認は `GET /api/health`。`prisma.config.ts` は `DATABASE_URL` がないと generate も失敗するので、イメージにはダミーの値を入れている（実行時は環境変数で上書き）。`docker-compose.prod.yml` は `name: yosuga-prod` で開発用（プロジェクト名 `yosuga`）とコンテナ・ボリュームを分けている。同梱の PostgreSQL は `bundled-db` プロファイル（`.env.production` の `COMPOSE_PROFILES`）で、外部の DB は `DATABASE_URL` を設定する（app の `depends_on` は `required: false`）。compose は無効なサービスの変数も展開するので、postgres の `POSTGRES_PASSWORD` に `:?` を付けないこと（外部 DB のときに起動できなくなる）。`install.sh` が対話式で `.env.production` を作る：値はシングルクォートで書き（`$` を展開させないため）、接続 URL のユーザー名・パスワードはパーセントエンコードする。再実行時はサーバー鍵と同梱 DB のパスワードを必ず引き継ぐ。
- **カスタムサーバー**（`apps/web/server/`）: `index.ts` が Next.js と共同編集を1つの HTTP サーバーで動かす。`env.ts` を必ず最初に import する（NODE_ENV と .env の読み込み）。`collab.ts` は Next.js にバンドルされないので、アプリ側（`src/lib/db.ts`）とは別の PrismaClient を持つ。Next.js は最初のリクエストで自前の upgrade リスナーを付け、開発時のホットリロード（`/_next/`）だけを処理し、ルートに一致しないパスの WebSocket には触らない。**`/collab` にページやルートを作らないこと**（作ると Next.js がその接続を切る）。tsx で動かすのは、`packages/shared` を TypeScript のまま使っているため。開発モードの Next.js は同じフォルダで2つ起動できない（2つ目はエラーで終了する）。
- **collabの認証**: エディタは接続のたびに Server Action `getCollabToken()` で5分有効の署名付きトークン（ユーザー＋ページ）を受け取る。署名鍵は `YOSUGA_SERVER_KEY` から HKDF で導出（`packages/shared/src/collab-token.ts`）。collab の `onAuthenticate` は署名・期限・ページ一致を確認したうえで、DB でページの権限を再確認する。閲覧のみなら読み取り専用。エディタは接続を拒否されても（トークン取得の失敗を含む）1・2・4秒おきに3回までやり直し、それでもだめなら「開けませんでした」を出す（`collaborative-editor.tsx` の `RETRY_DELAYS_MS`）。

## 現在の状況

完了:
- モノレポ構成、Prismaスキーマ、開発用の Docker Compose（Postgres / Redis / SeaweedFS）
- BlockNote + Yjs + Hocuspocus の共同編集（Next.js のカスタムサーバーに統合し、1プロセス・1ポート）
- 初回セットアップ（マスターパスワード）と暗号化（データ鍵・`pnpm rotate-server-key`）。ページ本文・履歴・添付ファイル・子ページテーブルの値・検索索引を暗号化
- ユーザー認証: 招待、ユーザーによるアカウント登録、シングルサインオン（OpenID Connect）、パスワードの再設定（メール／管理画面からのリンク発行）
- 管理画面 `/admin`: マスターパスワード／アカウント＋TOTP、ロール（サイト管理者・コンテンツ管理者・一般ユーザー）、ユーザーの無効化、グループ、IP 制限、回数制限、変更の記録、メール送信（SMTP）、ファイル保存（S3 互換）、アップロード上限、テーマ、公開 URL、復旧コマンド `pnpm admin:recover`
- ナレッジルートとページ: 作成・移動（サイドバーのドラッグ＆ドロップとページメニュー。別のナレッジルートへも）・並び替え・削除（ごみ箱・復元）、グループ単位の権限、共有画面、子ページ一覧／子ページテーブル
- ページの履歴（版の保存・復元・機密情報のマスク）、暗号化した索引による全文検索、ファイル添付
- 本番用の Docker イメージ（`Dockerfile`、`docker-compose.prod.yml`。ビルド・起動・マイグレーション・ヘルスチェック・停止時の保存を確認済み）

未着手（次の候補）:
- ごみ箱からの完全削除（添付ファイル・子ページテーブルの値・版の扱いを決める必要がある。版は監査のため削除しない方針との整合も）
- 添付ファイルの掃除（ブロックを消したファイルの削除）と、大きいファイル向けのストリーミング暗号化
- 古い版の自動削除（「版は削除しない」方針との整合を先に決める）
- ログイン中のユーザーが自分でパスワードを変更する画面
