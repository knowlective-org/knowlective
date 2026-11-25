import Link from "next/link";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { getDisplayTitle } from "@/i18n/display-title";
import { requireAdminView } from "@/lib/admin/auth";
import { USAGE_KEEP_DAYS } from "@/lib/usage";
import { USAGE_PERIODS, activityStats, parsePeriod, storageStats } from "@/lib/usage-stats";
import { bytesUnit } from "@/lib/usage-format";
import styles from "@/styles/ui.module.css";
import { AdminReadOnly } from "../admin-read-only";
import { UsageChart } from "./usage-chart";
import usage from "./usage.module.css";

// Knowledge roots shown before "more" (largest first; personal roots last).
const TOP_ROOTS = 10;

// The usage dashboard, for site admins (and auditors, read-only): how much
// data the site holds now, and what each person did over a period — edits,
// pages, chat, uploads, and API / MCP calls (lib/usage.ts, lib/usage-stats.ts).
// Counts only: no page titles or content. Knowledge roots by name as on
// /admin/roots, everyone's personal roots together.
export default async function AdminUsagePage({ searchParams }: PageProps<"/admin/usage">) {
  await connection();
  const { readOnly } = await requireAdminView(["SITE_ADMIN"]);
  const period = parsePeriod((await searchParams).days);
  const [storage, activity, t, format, displayTitle] = await Promise.all([
    storageStats(),
    activityStats(period),
    getTranslations("admin.usage"),
    getFormatter(),
    getDisplayTitle(),
  ]);

  const num = (v: number) => format.number(v);
  const bytes = (v: number) => {
    const { value, unit } = bytesUnit(v);
    return `${format.number(value, { maximumFractionDigits: unit === "B" || value >= 100 ? 0 : 1 })} ${unit}`;
  };
  const day = (d: string) => format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const tile = (label: string, value: string, note?: string, ui?: string) => (
    <div className={usage.tile} data-ui={ui ?? "AdminUsagePage.tile"}>
      <div className={usage.tileLabel}>{label}</div>
      <div className={usage.tileValue}>{value}</div>
      {note && <div className={usage.tileNote}>{note}</div>}
    </div>
  );

  const rootTable = (rows: typeof storage.roots) => (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("root")}</th>
            <th className={usage.num}>{t("pages")}</th>
            <th className={usage.num}>{t("fileCount")}</th>
            <th className={usage.num}>{t("fileSize")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id ?? "personal"} data-ui="AdminUsagePage.rootRow" data-id={r.id ?? undefined}>
              <td>
                {r.id === null ? t("personalRoots") : displayTitle(r.name ?? "")}
                {r.deleted && <span className={usage.muted}> {t("deletedRoot")}</span>}
              </td>
              <td className={usage.num}>{num(r.pages)}</td>
              <td className={usage.num}>{num(r.files)}</td>
              <td className={usage.num}>{bytes(r.bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <AdminReadOnly readOnly={readOnly}>
      <div className={usage.dashboard} data-ui="AdminUsagePage">
        <section className={styles.section} data-ui="AdminUsagePage.storageSection">
          <h2 className={styles.sectionTitle}>{t("storageHeading")}</h2>
          <p className={styles.note}>{t("storageLead")}</p>
          <div className={usage.tiles}>
            {tile(t("database"), bytes(storage.database), t("databaseNote"), "AdminUsagePage.databaseSize")}
            {storage.vectorDatabase !== null && tile(t("vectorDatabase"), bytes(storage.vectorDatabase), t("vectorDatabaseNote"))}
            {tile(
              t("files"),
              bytes(storage.files.bytes),
              t("filesNote", { count: storage.files.count, pending: bytes(storage.unreferenced.bytes) }),
              "AdminUsagePage.filesSize",
            )}
            {tile(t("documents"), bytes(storage.documents), t("documentsNote", { count: storage.pages.live, trash: storage.pages.trash }))}
            {tile(t("versions"), bytes(storage.versions.bytes), t("versionsNote", { count: storage.versions.count }))}
            {tile(t("users"), num(storage.users.active), t("usersNote", { disabled: storage.users.disabled }))}
          </div>
          {rootTable(storage.roots.slice(0, TOP_ROOTS))}
          {storage.roots.length > TOP_ROOTS && (
            <details className={usage.details} data-ui="AdminUsagePage.moreRoots">
              <summary>{t("moreRoots", { count: storage.roots.length - TOP_ROOTS })}</summary>
              {rootTable(storage.roots.slice(TOP_ROOTS))}
            </details>
          )}
        </section>

        <section className={styles.section} data-ui="AdminUsagePage.activitySection">
          <h2 className={styles.sectionTitle}>{t("activityHeading")}</h2>
          <p className={styles.note}>{t("activityLead", { keep: USAGE_KEEP_DAYS })}</p>
          <nav className={usage.periods} aria-label={t("period")} data-ui="AdminUsagePage.periods">
            {USAGE_PERIODS.map((p) => (
              <Link
                key={p}
                href={`/admin/usage?days=${p}`}
                className={p === period ? usage.periodCurrent : usage.period}
                aria-current={p === period ? "page" : undefined}
                data-ui="AdminUsagePage.periodLink"
                data-id={p}
              >
                {t("days", { count: p })}
              </Link>
            ))}
          </nav>
          <div className={usage.tiles}>
            {tile(t("activePeople"), num(activity.totals.activePeople), undefined, "AdminUsagePage.activePeople")}
            {tile(t("series.web"), num(activity.totals.web), t("editsNote"), "AdminUsagePage.webEdits")}
            {tile(t("pagesCreated"), num(activity.totals.pagesCreated))}
            {tile(t("chatMessages"), num(activity.totals.chatMessages))}
            {tile(t("series.api"), num(activity.totals.api), undefined, "AdminUsagePage.apiCalls")}
            {tile(t("series.mcp"), num(activity.totals.mcp), undefined, "AdminUsagePage.mcpCalls")}
          </div>
          <UsageChart days={activity.days} />
          <details className={usage.details} data-ui="AdminUsagePage.dailyTable">
            <summary>{t("dailyTable")}</summary>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("day")}</th>
                    <th className={usage.num}>{t("series.web")}</th>
                    <th className={usage.num}>{t("series.api")}</th>
                    <th className={usage.num}>{t("series.mcp")}</th>
                    <th className={usage.num}>{t("activePeople")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...activity.days].reverse().map((d) => (
                    <tr key={d.day}>
                      <td>{day(d.day)}</td>
                      <td className={usage.num}>{num(d.web)}</td>
                      <td className={usage.num}>{num(d.api)}</td>
                      <td className={usage.num}>{num(d.mcp)}</td>
                      <td className={usage.num}>{num(d.people)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section className={styles.section} data-ui="AdminUsagePage.peopleSection">
          <h2 className={styles.sectionTitle}>{t("peopleHeading")}</h2>
          <p className={styles.note}>{t("peopleLead")}</p>
          {activity.people.length === 0 ? (
            <p className={styles.note}>{t("none")}</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("person")}</th>
                    <th className={usage.num}>{t("edits")}</th>
                    <th className={usage.num}>{t("pagesCreated")}</th>
                    <th className={usage.num}>{t("chatMessages")}</th>
                    <th className={usage.num}>{t("uploads")}</th>
                    <th className={usage.num}>{t("apiReadWrite")}</th>
                    <th className={usage.num}>{t("mcpReadWrite")}</th>
                    <th className={usage.num}>{t("storedFiles")}</th>
                    <th>{t("lastActive")}</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.people.map((p) => (
                    <tr key={p.userId} className={p.disabled ? styles.disabledRow : undefined} data-ui="AdminUsagePage.personRow" data-id={p.userId}>
                      <td className={usage.person}>
                        {p.name}
                        {p.disabled && <span className={usage.muted}> {t("disabled")}</span>}
                      </td>
                      <td className={usage.num}>{num(p.edits)}</td>
                      <td className={usage.num}>{num(p.pagesCreated)}</td>
                      <td className={usage.num}>{num(p.chatMessages)}</td>
                      <td className={usage.num}>{p.uploads ? `${num(p.uploads)} (${bytes(p.uploadBytes)})` : "0"}</td>
                      <td className={usage.num}>{`${num(p.apiRead)} / ${num(p.apiWrite)}`}</td>
                      <td className={usage.num}>{`${num(p.mcpRead)} / ${num(p.mcpWrite)}`}</td>
                      <td className={usage.num}>{bytes(p.storedBytes)}</td>
                      <td>{p.lastActive ? day(p.lastActive) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.section} data-ui="AdminUsagePage.viaSection">
          <h2 className={styles.sectionTitle}>{t("viaHeading")}</h2>
          <p className={styles.note}>{t("viaLead")}</p>
          {activity.via.length === 0 ? (
            <p className={styles.note}>{t("none")}</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("via")}</th>
                    <th>{t("owner")}</th>
                    <th>{t("channel")}</th>
                    <th className={usage.num}>{t("reads")}</th>
                    <th className={usage.num}>{t("writes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.via.map((v, i) => (
                    <tr key={i} data-ui="AdminUsagePage.viaRow">
                      <td>
                        {v.label === null ? (
                          <span className={usage.muted}>{t(v.kind === "key" ? "removedKey" : "removedApp")}</span>
                        ) : v.kind === "key" ? (
                          t("apiKey", { prefix: v.label })
                        ) : (
                          t("app", { name: v.label })
                        )}
                      </td>
                      <td>{format.list(v.owners)}</td>
                      <td>{v.channels.join(", ")}</td>
                      <td className={usage.num}>{num(v.read)}</td>
                      <td className={usage.num}>{num(v.write)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.section} data-ui="AdminUsagePage.toolsSection">
          <h2 className={styles.sectionTitle}>{t("toolsHeading")}</h2>
          {activity.tools.length === 0 ? (
            <p className={styles.note}>{t("none")}</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("tool")}</th>
                    <th>{t("kind")}</th>
                    <th className={usage.num}>{t("calls")}</th>
                    <th className={usage.num}>{t("toolPeople")}</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.tools.map((tool) => (
                    <tr key={`${tool.tool}:${tool.write}`} data-ui="AdminUsagePage.toolRow" data-id={tool.tool}>
                      <td>
                        <code>{tool.tool}</code>
                      </td>
                      <td>{tool.write ? t("write") : t("read")}</td>
                      <td className={usage.num}>{num(tool.calls)}</td>
                      <td className={usage.num}>{num(tool.people)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminReadOnly>
  );
}
