import Link from "next/link";
import styles from "./pagination.module.css";

// Page links for a long list: ‹ 前へ, page numbers (the first, the last and
// those around the current one, with … between), 次へ ›. Plain links, so it
// works without JavaScript; `href(page)` makes each one.
export function Pagination({
  page,
  pageCount,
  href,
  label,
}: {
  // 1-based.
  page: number;
  pageCount: number;
  href: (page: number) => string;
  // What is paged, for screen readers (e.g. "変更の記録").
  label: string;
}) {
  if (pageCount <= 1) return null;
  const numbers: (number | "gap")[] = [];
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 2) numbers.push(n);
    else if (numbers[numbers.length - 1] !== "gap") numbers.push("gap");
  }

  return (
    <nav className={styles.pagination} aria-label={`${label}のページ`} data-ui="Pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className={styles.link} rel="prev" data-ui="Pagination.prevLink">
          ‹ 前へ
        </Link>
      ) : (
        <span className={styles.disabled}>‹ 前へ</span>
      )}
      {numbers.map((n, i) =>
        n === "gap" ? (
          <span key={`gap-${i}`} className={styles.gap}>
            …
          </span>
        ) : n === page ? (
          <span key={n} className={styles.current} aria-current="page" data-ui="Pagination.current">
            {n}
          </span>
        ) : (
          <Link key={n} href={href(n)} className={styles.link} data-ui="Pagination.pageLink" data-id={n}>
            {n}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link href={href(page + 1)} className={styles.link} rel="next" data-ui="Pagination.nextLink">
          次へ ›
        </Link>
      ) : (
        <span className={styles.disabled}>次へ ›</span>
      )}
    </nav>
  );
}

// The page number from a search parameter, kept within 1..pageCount.
export function pageParam(raw: unknown, pageCount: number): number {
  const n = Number(typeof raw === "string" ? raw : 1);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), Math.max(pageCount, 1)) : 1;
}
