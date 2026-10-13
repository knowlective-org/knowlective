#!/usr/bin/env bash
# yosuga のインストール（本番用 Docker Compose）。
# 設定を対話式で聞いて .env.production を作り、必要なら起動まで行う。
#
#   ./install.sh
#
# もう一度実行すると、今の .env.production の値を初期値にして作り直せる
# （元のファイルは .env.production.bak.<日時> に残す）。
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=".env.production"
COMPOSE_FILE_NAME="docker-compose.prod.yml"
PG_IMAGE="postgres:16-alpine"

# ---- 表示と入力 ------------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; GREEN=$'\e[32m'; RESET=$'\e[0m'
else
  BOLD=""; DIM=""; RED=""; YELLOW=""; GREEN=""; RESET=""
fi

section() { printf '\n%s== %s ==%s\n' "$BOLD" "$1" "$RESET"; }
info()    { printf '%s\n' "$*"; }
note()    { printf '%s%s%s\n' "$DIM" "$*" "$RESET"; }
warn()    { printf '%s注意: %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }
die()     { printf '%sエラー: %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# ask <変数名> <質問> [初期値]
ask() {
  local __var=$1 __prompt=$2 __default=${3-} __answer
  if [ -n "$__default" ]; then
    read -r -p "$__prompt [$__default]: " __answer || exit 1
    __answer=${__answer:-$__default}
  else
    read -r -p "$__prompt: " __answer || exit 1
  fi
  printf -v "$__var" '%s' "$__answer"
}

# ask_secret <変数名> <質問>（入力を表示しない。空は不可）
ask_secret() {
  local __var=$1 __prompt=$2 __answer
  while :; do
    read -r -s -p "$__prompt: " __answer || exit 1
    echo
    [ -n "$__answer" ] && break
    info "入力してください。"
  done
  printf -v "$__var" '%s' "$__answer"
}

# ask_yes_no <質問> <y|n>（初期値）→ y なら 0
ask_yes_no() {
  local __prompt=$1 __default=$2 __answer __hint
  [ "$__default" = y ] && __hint="Y/n" || __hint="y/N"
  while :; do
    read -r -p "$__prompt [$__hint]: " __answer || exit 1
    __answer=${__answer:-$__default}
    case "$__answer" in
      [yY]*) return 0 ;;
      [nN]*) return 1 ;;
    esac
  done
}

# ask_choice <変数名> <初期値の番号> <選択肢1> <選択肢2> ... → 番号
ask_choice() {
  local __var=$1 __default=$2 __answer i
  shift 2
  for i in $(seq 1 $#); do
    info "  $i) ${!i}"
  done
  while :; do
    read -r -p "番号を選んでください [$__default]: " __answer || exit 1
    __answer=${__answer:-$__default}
    if [[ "$__answer" =~ ^[0-9]+$ ]] && [ "$__answer" -ge 1 ] && [ "$__answer" -le $# ]; then
      break
    fi
  done
  printf -v "$__var" '%s' "$__answer"
}

# ---- 値の生成と検証 --------------------------------------------------------

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

rand_base64_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  else
    head -c 32 /dev/urandom | base64
  fi
}

# YOSUGA_SERVER_KEY の形式（base64 で 32 バイト）
valid_server_key() {
  [[ "$1" =~ ^[A-Za-z0-9+/]+=*$ ]] || return 1
  [ "$(printf '%s' "$1" | base64 --decode 2>/dev/null | wc -c | tr -d ' ')" = 32 ]
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# 接続 URL に入れるためのパーセントエンコード
urlencode() {
  local LC_ALL=C s=$1 out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case "$c" in
      [A-Za-z0-9._~-]) out+=$c ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

# .env.production の値（シングルクォートは外す）
existing() {
  [ -f "$ENV_FILE" ] || return 0
  local line
  line=$(grep -E "^$1=" "$ENV_FILE" | tail -n 1) || return 0
  line=${line#*=}
  line=${line#\'}; line=${line%\'}
  line=${line#\"}; line=${line%\"}
  printf '%s' "$line"
}

# 画面に出すときは先頭だけ
mask() { printf '%s…（%d文字）' "${1:0:4}" "${#1}"; }

# 接続 URL からパスワードを除いた表示（user@host:port/db?...）
display_url() { printf '%s' "$1" | sed -E 's#^[a-z]+://##; s#^([^:@]*):[^@]*@#\1@#'; }

# ---- 事前の確認 ------------------------------------------------------------

[ -f "$COMPOSE_FILE_NAME" ] || die "$COMPOSE_FILE_NAME が見つかりません。yosuga のディレクトリで実行してください。"
command -v docker >/dev/null 2>&1 || die "docker が見つかりません。Docker Engine（または Docker Desktop）をインストールしてください。"
docker compose version >/dev/null 2>&1 || die "docker compose（v2）が使えません。Docker Compose プラグインをインストールしてください。"
docker info >/dev/null 2>&1 || die "Docker に接続できません。Docker が起動しているか、このユーザーで docker を実行できるか確認してください。"

info "${BOLD}yosuga のインストール${RESET}"
info "質問に答えると $ENV_FILE を作成します。[ ] 内は初期値で、Enter だけでその値になります。"

if [ -f "$ENV_FILE" ]; then
  section "既存の設定"
  info "$ENV_FILE がすでにあります。今の値を初期値にして作り直します（元のファイルは退避します）。"
  ask_yes_no "続けますか" y || { info "中止しました。"; exit 0; }
fi

# ---- データベース ----------------------------------------------------------

section "データベース（PostgreSQL）"
info "どの PostgreSQL を使いますか。"
default_db=1
[ -n "$(existing DATABASE_URL)" ] && default_db=2
ask_choice DB_CHOICE "$default_db" \
  "同梱の PostgreSQL を使う（このサーバーのコンテナで動かす）" \
  "別途用意した PostgreSQL を使う（16 以上を推奨）"

DATABASE_URL=""
POSTGRES_PASSWORD=""
COMPOSE_PROFILES=""

if [ "$DB_CHOICE" = 1 ]; then
  COMPOSE_PROFILES="bundled-db"
  POSTGRES_PASSWORD=$(existing POSTGRES_PASSWORD)
  if [ -n "$POSTGRES_PASSWORD" ]; then
    note "パスワードは今の設定を引き継ぎます（初期化済みのデータベースは、パスワードを変えても反映されないため）。"
  else
    POSTGRES_PASSWORD=$(rand_hex 32)
    note "パスワードを自動で作成しました。"
    if docker volume inspect yosuga-prod_postgres_data >/dev/null 2>&1; then
      warn "同梱の PostgreSQL のデータ（ボリューム yosuga-prod_postgres_data）がすでにあります。"
      warn "新しいパスワードでは接続できません。以前の $ENV_FILE を戻すか、不要ならボリュームを削除してください。"
      ask_yes_no "このまま続けますか" n || { info "中止しました。"; exit 1; }
    fi
  fi
elif [ -n "$(existing DATABASE_URL)" ] &&
  ask_yes_no "今の接続先（$(display_url "$(existing DATABASE_URL)")）を引き継ぎますか" y; then
  DATABASE_URL=$(existing DATABASE_URL)
else
  info "接続先を入力してください。データベースとユーザーは先に作っておき、ユーザーにはテーブルを作る権限を付けてください。"
  info "（起動時にマイグレーションでテーブルを作ります）"
  while :; do
    while :; do
      ask DB_HOST "ホスト名または IP アドレス"
      case "$DB_HOST" in
        "") info "入力してください。" ;;
        localhost|127.0.0.1|::1)
          warn "コンテナの中から見た localhost は、そのコンテナ自身です。このサーバーで動いている PostgreSQL なら、"
          warn "サーバーの IP アドレス（Docker Desktop なら host.docker.internal）を指定してください。"
          ask_yes_no "$DB_HOST のままにしますか" n && break ;;
        *) break ;;
      esac
    done
    while :; do
      ask DB_PORT "ポート番号" 5432
      valid_port "$DB_PORT" && break
      info "1〜65535 の数字を入力してください。"
    done
    ask DB_NAME "データベース名" yosuga
    ask DB_USER "ユーザー名" yosuga
    ask_secret DB_PASSWORD "パスワード（入力は表示されません）"
    info "SSL で接続しますか。"
    ask_choice DB_SSL 1 "使わない（同じネットワーク内など）" "使う（sslmode=require）"

    DATABASE_URL="postgresql://$(urlencode "$DB_USER"):$(urlencode "$DB_PASSWORD")@${DB_HOST}:${DB_PORT}/$(urlencode "$DB_NAME")"
    [ "$DB_SSL" = 2 ] && DATABASE_URL+="?sslmode=require"

    if ask_yes_no "接続を確認しますか（$PG_IMAGE のコンテナから接続します）" y; then
      info "接続しています…"
      if version=$(docker run --rm -e PGCONNECT_TIMEOUT=10 "$PG_IMAGE" \
          psql "$DATABASE_URL" -tA -c "SHOW server_version" 2>&1); then
        info "${GREEN}接続できました（PostgreSQL ${version%%$'\n'*}）。${RESET}"
        break
      fi
      warn "接続できませんでした:"
      printf '%s\n' "$version" | tail -n 3 >&2
      ask_yes_no "入力し直しますか" y && continue
      ask_yes_no "このまま続けますか" n || { info "中止しました。"; exit 1; }
    fi
    break
  done
fi

# ---- サーバー鍵 ------------------------------------------------------------

section "サーバー鍵（YOSUGA_SERVER_KEY）"
info "データを暗号化する鍵を取り出すための鍵です。マスターパスワードと両方を失うと、データは復旧できません。"
YOSUGA_SERVER_KEY=$(existing YOSUGA_SERVER_KEY)
if [ -n "$YOSUGA_SERVER_KEY" ] && valid_server_key "$YOSUGA_SERVER_KEY"; then
  note "今の鍵を引き継ぎます（変えるとデータを読めなくなるため。鍵の交換は pnpm rotate-server-key で行います）。"
else
  ask_choice KEY_CHOICE 1 "新しく作る（新規インストール）" "既存の鍵を入力する（移行・復元）"
  if [ "$KEY_CHOICE" = 1 ]; then
    YOSUGA_SERVER_KEY=$(rand_base64_32)
    note "鍵を作成しました。"
  else
    while :; do
      ask_secret YOSUGA_SERVER_KEY "サーバー鍵（入力は表示されません）"
      valid_server_key "$YOSUGA_SERVER_KEY" && break
      info "形式が正しくありません（base64 で 32 バイト。例: openssl rand -base64 32 の出力）。"
    done
  fi
fi

# ---- ファイル保存 ----------------------------------------------------------

# 同梱の SeaweedFS の認証情報。利用者が決める必要はないので自動で作る。
SEAWEEDFS_ACCESS_KEY=$(existing SEAWEEDFS_ACCESS_KEY)
SEAWEEDFS_SECRET_KEY=$(existing SEAWEEDFS_SECRET_KEY)
[ -n "$SEAWEEDFS_ACCESS_KEY" ] || SEAWEEDFS_ACCESS_KEY=$(rand_hex 16)
[ -n "$SEAWEEDFS_SECRET_KEY" ] || SEAWEEDFS_SECRET_KEY=$(rand_hex 32)

# ---- 公開まわり ------------------------------------------------------------

section "ネットワーク"
info "アプリは 127.0.0.1 の指定ポートで待ち受けます。外部にはリバースプロキシ（Caddy / nginx など）経由で公開してください。"
default_port=$(existing YOSUGA_PORT); default_port=${default_port:-3000}
while :; do
  ask YOSUGA_PORT "待ち受けるポート番号" "$default_port"
  valid_port "$YOSUGA_PORT" && break
  info "1〜65535 の数字を入力してください。"
done
default_hops=$(existing YOSUGA_TRUSTED_PROXY_HOPS); default_hops=${default_hops:-1}
while :; do
  ask YOSUGA_TRUSTED_PROXY_HOPS "アプリの前にあるリバースプロキシの段数（CDN → nginx なら 2）" "$default_hops"
  [[ "$YOSUGA_TRUSTED_PROXY_HOPS" =~ ^[1-9][0-9]*$ ]] && break
  info "1 以上の数字を入力してください。"
done
# サブパス（空でよい）。前回の値があれば初期値にし、消すときは - を入力する。
default_base=$(existing YOSUGA_BASE_PATH)
info "リバースプロキシで https://example.com/yosuga/ のようにサブパスで公開する場合は、そのパス（例: /yosuga）を入力してください。"
info "ルート（https://yosuga.example.com/）で公開する場合は、空のまま Enter を押します。"
while :; do
  if [ -n "$default_base" ]; then
    ask YOSUGA_BASE_PATH "サブパス（なしにするには - を入力）" "$default_base"
    [ "$YOSUGA_BASE_PATH" = "-" ] && YOSUGA_BASE_PATH=""
  else
    ask YOSUGA_BASE_PATH "サブパス（なければ空のまま）"
  fi
  YOSUGA_BASE_PATH=${YOSUGA_BASE_PATH%/}
  [ -z "$YOSUGA_BASE_PATH" ] && break
  [[ "$YOSUGA_BASE_PATH" =~ ^(/[A-Za-z0-9._~-]+)+$ ]] && break
  info "/ で始まる英数字のパスを入力してください（例: /yosuga、/tools/yosuga）。"
done

section "その他"
default_tz=$(existing TZ); default_tz=${default_tz:-Asia/Tokyo}
while :; do
  ask TZ_VALUE "タイムゾーン（管理画面の日時の表示）" "$default_tz"
  [[ "$TZ_VALUE" =~ ^[A-Za-z0-9_+/-]+$ ]] && break
  info "Asia/Tokyo のような形式で入力してください。"
done
info "yosuga を改変して公開する場合は、改変後のソースコードの URL を入力してください（AGPL-3.0）。"
url_pattern='^https?://[^[:space:]'"'"'"]+$'
while :; do
  ask YOSUGA_SOURCE_URL "ソースコードの URL（空欄なら公式のリポジトリ）" "$(existing YOSUGA_SOURCE_URL)"
  if [ -z "$YOSUGA_SOURCE_URL" ] || [[ "$YOSUGA_SOURCE_URL" =~ $url_pattern ]]; then break; fi
  info "http:// か https:// で始まる URL を入力してください。"
done

# ---- 確認と書き込み --------------------------------------------------------

section "確認"
if [ "$DB_CHOICE" = 1 ]; then
  info "データベース      : 同梱の PostgreSQL（パスワード $(mask "$POSTGRES_PASSWORD")）"
else
  info "データベース      : $(display_url "$DATABASE_URL")"
fi
info "サーバー鍵        : $(mask "$YOSUGA_SERVER_KEY")"
info "ファイル保存      : 同梱の SeaweedFS（認証情報は自動作成。外部の S3 は管理画面で設定）"
info "ポート            : 127.0.0.1:${YOSUGA_PORT}"
info "プロキシの段数    : ${YOSUGA_TRUSTED_PROXY_HOPS}"
info "サブパス          : ${YOSUGA_BASE_PATH:-（なし。ルートで公開）}"
info "タイムゾーン      : ${TZ_VALUE}"
info "ソースコードの URL: ${YOSUGA_SOURCE_URL:-（公式のリポジトリ）}"
echo
ask_yes_no "この内容で $ENV_FILE を書き込みますか" y || { info "中止しました（何も書き込んでいません）。"; exit 0; }

if [ -f "$ENV_FILE" ]; then
  backup="$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  cp -p "$ENV_FILE" "$backup"
  chmod 600 "$backup" 2>/dev/null || true
  note "元のファイルを $backup に退避しました。"
fi

(
  umask 077
  {
    echo "# yosuga の本番設定（install.sh で作成: $(date '+%Y-%m-%d %H:%M:%S')）"
    echo "# docker compose -f $COMPOSE_FILE_NAME --env-file $ENV_FILE up -d --build"
    echo "# 秘密の値を含みます。共有・コミットせず、安全な場所にバックアップしてください。"
    echo
    if [ -n "$COMPOSE_PROFILES" ]; then
      echo "# 同梱の PostgreSQL を使う"
      echo "COMPOSE_PROFILES='$COMPOSE_PROFILES'"
      echo "POSTGRES_PASSWORD='$POSTGRES_PASSWORD'"
    else
      echo "# 別途用意した PostgreSQL"
      echo "DATABASE_URL='$DATABASE_URL'"
    fi
    echo
    echo "YOSUGA_SERVER_KEY='$YOSUGA_SERVER_KEY'"
    echo "SEAWEEDFS_ACCESS_KEY='$SEAWEEDFS_ACCESS_KEY'"
    echo "SEAWEEDFS_SECRET_KEY='$SEAWEEDFS_SECRET_KEY'"
    echo
    echo "YOSUGA_PORT='$YOSUGA_PORT'"
    echo "YOSUGA_TRUSTED_PROXY_HOPS='$YOSUGA_TRUSTED_PROXY_HOPS'"
    if [ -n "$YOSUGA_BASE_PATH" ]; then
      echo "YOSUGA_BASE_PATH='$YOSUGA_BASE_PATH'"
    fi
    echo "TZ='$TZ_VALUE'"
    if [ -n "$YOSUGA_SOURCE_URL" ]; then
      echo "YOSUGA_SOURCE_URL='$YOSUGA_SOURCE_URL'"
    fi
  } > "$ENV_FILE"
)
chmod 600 "$ENV_FILE" 2>/dev/null || true
info "${GREEN}$ENV_FILE を作成しました。${RESET}"
warn "$ENV_FILE（特に YOSUGA_SERVER_KEY）を安全な場所にバックアップしてください。"

# ---- 起動 ------------------------------------------------------------------

COMPOSE=(docker compose -f "$COMPOSE_FILE_NAME" --env-file "$ENV_FILE")

section "起動"
if ! ask_yes_no "イメージをビルドして起動しますか（初回は数分かかります）" y; then
  info "あとで次のコマンドで起動できます:"
  info "  ${COMPOSE[*]} up -d --build"
  exit 0
fi

"${COMPOSE[@]}" up -d --build

info "起動を待っています（データベースのマイグレーションを含みます）…"
app_id=$("${COMPOSE[@]}" ps -q app)
status=""
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_id" 2>/dev/null || echo unknown)
  case "$status" in
    healthy) break ;;
    exited|dead) break ;;
  esac
  sleep 5
done

if [ "$status" != healthy ]; then
  warn "起動を確認できませんでした（状態: $status）。ログを確認してください:"
  "${COMPOSE[@]}" logs --tail 40 app >&2 || true
  exit 1
fi

section "完了"
info "${GREEN}yosuga が起動しました（127.0.0.1:${YOSUGA_PORT}）。${RESET}"
info "次の手順:"
info "  1. リバースプロキシで公開用のドメインから 127.0.0.1:${YOSUGA_PORT} へ転送する"
info "     （/collab の WebSocket も通し、X-Forwarded-For と X-Forwarded-Proto を渡す）"
info "  2. https://<公開用のドメイン>/ を開き、初回セットアップ（マスターパスワードの設定）を行う"
info "  3. $ENV_FILE をバックアップする"
info "ログ: ${COMPOSE[*]} logs -f app"
