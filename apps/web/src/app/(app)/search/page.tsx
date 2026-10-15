import type { Metadata } from "next";
import { withBasePath } from "@/lib/base-path";
import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { displayTitle } from "@/lib/page-title";
import { MAX_QUERY_LENGTH, searchPages } from "@/lib/search";
import { isSearchMode } from "@/lib/search-mode";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import searchStyles from "./search.module.css";

export const metadata: Metadata = { title: "検索 | YOSUGA" };

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

// /search?q=…[&mode=keyword|semantic] — search over the pages the user can
// open. Without mode, the kind of search is chosen from the query
// (lib/search-mode.ts).
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await connection();
  const params = await searchParams;
  const raw = params.q;
  const query = (typeof raw === "string" ? raw : "").trim().slice(0, MAX_QUERY_LENGTH);
  const requested = isSearchMode(params.mode) ? params.mode : undefined;
  const user = await requireUser(`/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const [sidebar, outcome] = await Promise.all([
    loadSidebar(user),
    query ? searchPages(user.id, query, requested) : null,
  ]);
  const results = outcome?.results ?? [];
  const otherMode = outcome?.mode === "semantic" ? "keyword" : "semantic";

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} searchQuery={query} />}>
      <div className={styles.pane} data-ui="SearchPage">
        <h1 className={styles.title}>検索</h1>
        <form action={withBasePath("/search")} className={searchStyles.form} role="search">
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={MAX_QUERY_LENGTH}
            placeholder="タイトル・本文・添付ファイル名を検索"
            className={styles.field}
            autoFocus={!query}
            data-ui="SearchPage.input"
          />
          <button type="submit" className={styles.button}>
            検索
          </button>
        </form>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          見られるページだけを検索します。短い語や型番はそのまま探し、文章のような検索語では意味の近いページも探します。
        </p>

        {/* Which search was used: only when there is a choice (semantic search set up). */}
        {outcome && outcome.semantic !== "off" && (
          <p className={searchStyles.mode} data-ui="SearchPage.status" data-mode={outcome.mode}>
            {outcome.semantic === "loading"
              ? "語をそのまま探しました（意味での検索は準備中です）。"
              : (outcome.reason ??
                (outcome.mode === "semantic" ? "意味の近いページも探しました。" : "語をそのまま探しました。"))}
            {outcome.semantic === "ready" && (
              <Link
                href={`/search?q=${encodeURIComponent(query)}&mode=${otherMode}`}
                data-ui="SearchPage.switchModeLink"
              >
                {otherMode === "semantic" ? "意味の近いページも探す" : "語をそのまま探す"}
              </Link>
            )}
          </p>
        )}
        {outcome && (
          <p className={searchStyles.count} data-ui="SearchPage.count">
            {results.length === 0 ? "見つかりませんでした。" : `${results.length}件${results.length >= 50 ? "（上位50件）" : ""}`}
          </p>
        )}
        <ol className={searchStyles.results} data-ui="SearchPage.results">
          {results.map((r) => (
            <li key={r.id} className={searchStyles.result} data-ui="SearchPage.result" data-id={r.id}>
              {r.path.length > 0 && <div className={searchStyles.path}>{r.path.join(" / ")}</div>}
              <Link href={`/pages/${r.id}`} className={searchStyles.title}>
                {displayTitle(r.title)}
              </Link>
              {r.bySemantic && <span className={searchStyles.badge}>意味が近い</span>}
              {r.snippet && (
                <p className={searchStyles.snippet}>
                  {r.snippet.map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
                </p>
              )}
              {r.matchedFile && <p className={searchStyles.snippet}>添付ファイル: {r.matchedFile}</p>}
              <div className={searchStyles.meta}>更新 {dateTimeFormat.format(new Date(r.updatedAt))}</div>
            </li>
          ))}
        </ol>
      </div>
    </AppShell>
  );
}
