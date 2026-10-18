import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { getDisplayTitle } from "@/i18n/display-title";
import { withBasePath } from "@/lib/base-path";
import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { MAX_QUERY_LENGTH, searchPages } from "@/lib/search";
import { isSearchMode } from "@/lib/search-mode";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import searchStyles from "./search.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("search.title") }) };
}

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
  const [sidebar, outcome, t, format, displayTitle] = await Promise.all([
    loadSidebar(user),
    query ? searchPages(user.id, query, requested) : null,
    getTranslations("search"),
    getFormatter(),
    getDisplayTitle(),
  ]);
  const results = outcome?.results ?? [];
  const otherMode = outcome?.mode === "semantic" ? "keyword" : "semantic";

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} searchQuery={query} />}>
      <div className={styles.pane} data-ui="SearchPage">
        <h1 className={styles.title}>{t("title")}</h1>
        <form action={withBasePath("/search")} className={searchStyles.form} role="search">
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t("placeholder")}
            className={styles.field}
            autoFocus={!query}
            data-ui="SearchPage.input"
          />
          <button type="submit" className={styles.button}>
            {t("submit")}
          </button>
        </form>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("note")}
        </p>

        {/* Which search was used: only when there is a choice (semantic search set up). */}
        {outcome && outcome.semantic !== "off" && (
          <p className={searchStyles.mode} data-ui="SearchPage.status" data-mode={outcome.mode}>
            {outcome.semantic === "loading"
              ? t("keywordOnly")
              : outcome.reason
                ? t(`reasons.${outcome.reason}`)
                : outcome.mode === "semantic"
                  ? t("semantic")
                  : t("keyword")}
            {outcome.semantic === "ready" && (
              <Link
                href={`/search?q=${encodeURIComponent(query)}&mode=${otherMode}`}
                data-ui="SearchPage.switchModeLink"
              >
                {otherMode === "semantic" ? t("switchSemantic") : t("switchKeyword")}
              </Link>
            )}
          </p>
        )}
        {outcome && (
          <p className={searchStyles.count} data-ui="SearchPage.count">
            {results.length === 0 ? t("none") : t("count", { count: results.length, top: String(results.length >= 50) })}
          </p>
        )}
        <ol className={searchStyles.results} data-ui="SearchPage.results">
          {results.map((r) => (
            <li key={r.id} className={searchStyles.result} data-ui="SearchPage.result" data-id={r.id}>
              {r.path.length > 0 && <div className={searchStyles.path}>{r.path.join(" / ")}</div>}
              <Link href={`/pages/${r.id}`} className={searchStyles.title}>
                {displayTitle(r.title)}
              </Link>
              {r.bySemantic && <span className={searchStyles.badge}>{t("bySemantic")}</span>}
              {r.snippet && (
                <p className={searchStyles.snippet}>
                  {r.snippet.map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
                </p>
              )}
              {r.matchedFile && <p className={searchStyles.snippet}>{t("file", { name: r.matchedFile })}</p>}
              <div className={searchStyles.meta}>
                {t("updated", { date: format.dateTime(new Date(r.updatedAt), { dateStyle: "medium", timeStyle: "short" }) })}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </AppShell>
  );
}
