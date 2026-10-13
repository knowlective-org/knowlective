import type { Metadata } from "next";
import { withBasePath } from "@/lib/base-path";
import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { displayTitle } from "@/lib/page-title";
import { MAX_QUERY_LENGTH, searchPages } from "@/lib/search";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import searchStyles from "./search.module.css";

export const metadata: Metadata = { title: "検索 | YOSUGA" };

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

// /search?q=… — full-text search over the pages the user can open.
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await connection();
  const raw = (await searchParams).q;
  const query = (typeof raw === "string" ? raw : "").trim().slice(0, MAX_QUERY_LENGTH);
  const user = await requireUser(`/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const [sidebar, results] = await Promise.all([loadSidebar(user), query ? searchPages(user.id, query) : []]);

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
          見られるページだけを検索します。スペースで区切ると、すべての語を含むページを探します。
        </p>

        {query && (
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
