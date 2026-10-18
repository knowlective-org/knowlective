import Link from "next/link";
import { useTranslations } from "next-intl";
import styles from "./pagination.module.css";

// Page links for a long list: ‹ previous, page numbers (the first, the last and
// those around the current one, with … between), next ›. Plain links, so it
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
  // What is paged, for screen readers (e.g. the audit log).
  label: string;
}) {
  const t = useTranslations("pagination");
  if (pageCount <= 1) return null;
  const numbers: (number | "gap")[] = [];
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 2) numbers.push(n);
    else if (numbers[numbers.length - 1] !== "gap") numbers.push("gap");
  }

  return (
    <nav className={styles.pagination} aria-label={t("label", { label })} data-ui="Pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className={styles.link} rel="prev" data-ui="Pagination.prevLink">
          {t("previous")}
        </Link>
      ) : (
        <span className={styles.disabled}>{t("previous")}</span>
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
          {t("next")}
        </Link>
      ) : (
        <span className={styles.disabled}>{t("next")}</span>
      )}
    </nav>
  );
}

// The page number from a search parameter, kept within 1..pageCount.
export function pageParam(raw: unknown, pageCount: number): number {
  const n = Number(typeof raw === "string" ? raw : 1);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), Math.max(pageCount, 1)) : 1;
}
