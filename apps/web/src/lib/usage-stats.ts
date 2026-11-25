import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { vectorDatabaseSize } from "@/lib/semantic-bridge";
import { usageDay } from "@/lib/usage";

// What the admin console's usage dashboard (/admin/usage) shows: the data
// held now, and what people did over a period (lib/usage.ts counts, plus
// pages created and chat messages from their own tables). Names only of
// knowledge roots that aren't anyone's own (as /admin/roots), and of users
// (as /admin/users); never page titles or content.

export const USAGE_PERIODS = [7, 30, 90, 365] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export function parsePeriod(value: unknown): UsagePeriod {
  const n = Number(value);
  return (USAGE_PERIODS as readonly number[]).includes(n) ? (n as UsagePeriod) : 30;
}

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

// ---- Storage, now --------------------------------------------------------------

export type RootStorage = {
  // Null: everyone's personal roots together.
  id: string | null;
  name: string | null;
  deleted: boolean;
  pages: number;
  files: number;
  bytes: number;
};

export type StorageStats = {
  database: number;
  vectorDatabase: number | null;
  files: { count: number; bytes: number };
  // Shown by no page any more; deleted after the grace period (lib/file-cleanup.ts).
  unreferenced: { count: number; bytes: number };
  documents: number;
  versions: { count: number; bytes: number };
  pages: { live: number; trash: number };
  users: { active: number; disabled: number };
  roots: RootStorage[];
};

export async function storageStats(): Promise<StorageStats> {
  const [db, docs, versions, files, unreferenced, livePages, trashPages, activeUsers, disabledUsers, fileRoots, pageRoots, roots, vector] =
    await Promise.all([
      prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
      prisma.$queryRaw<{ size: bigint | null }[]>`SELECT SUM(octet_length("state"))::bigint AS size FROM "PageDocument"`,
      prisma.$queryRaw<{ count: bigint; size: bigint | null }[]>`SELECT COUNT(*) AS count, SUM(octet_length("state"))::bigint AS size FROM "PageVersion"`,
      prisma.fileObject.aggregate({ _count: true, _sum: { size: true } }),
      prisma.fileObject.aggregate({ where: { unreferencedAt: { not: null } }, _count: true, _sum: { size: true } }),
      prisma.page.count({ where: { deletedAt: null } }),
      prisma.page.count({ where: { deletedAt: { not: null } } }),
      prisma.user.count({ where: { disabledAt: null } }),
      prisma.user.count({ where: { disabledAt: { not: null } } }),
      prisma.fileObject.groupBy({ by: ["rootId"], _count: true, _sum: { size: true } }),
      prisma.page.groupBy({ by: ["rootId"], where: { deletedAt: null }, _count: true }),
      prisma.knowledgeRoot.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, ownerId: true, deletedAt: true, rootPage: { select: { title: true } } },
      }),
      vectorDatabaseSize(),
    ]);

  const filesOf = new Map(fileRoots.map((r) => [r.rootId, { count: r._count, bytes: n(r._sum.size) }]));
  const pagesOf = new Map(pageRoots.map((r) => [r.rootId, r._count]));
  const personal: RootStorage = { id: null, name: null, deleted: false, pages: 0, files: 0, bytes: 0 };
  const shared: RootStorage[] = [];
  for (const root of roots) {
    const f = filesOf.get(root.id) ?? { count: 0, bytes: 0 };
    const pages = pagesOf.get(root.id) ?? 0;
    if (root.ownerId) {
      personal.pages += pages;
      personal.files += f.count;
      personal.bytes += f.bytes;
    } else {
      shared.push({ id: root.id, name: root.rootPage?.title ?? "", deleted: !!root.deletedAt, pages, files: f.count, bytes: f.bytes });
    }
  }
  shared.sort((a, b) => b.bytes - a.bytes || b.pages - a.pages);

  return {
    database: n(db[0]?.size),
    vectorDatabase: vector,
    files: { count: files._count, bytes: n(files._sum.size) },
    unreferenced: { count: unreferenced._count, bytes: n(unreferenced._sum.size) },
    documents: n(docs[0]?.size),
    versions: { count: n(versions[0]?.count), bytes: n(versions[0]?.size) },
    pages: { live: livePages, trash: trashPages },
    users: { active: activeUsers, disabled: disabledUsers },
    roots: [...shared, personal],
  };
}

// ---- Activity over a period ------------------------------------------------------

export type DayActivity = { day: string; web: number; api: number; mcp: number; people: number };

export type PersonActivity = {
  userId: string;
  name: string;
  disabled: boolean;
  edits: number;
  pagesCreated: number;
  chatMessages: number;
  uploads: number;
  uploadBytes: number;
  apiRead: number;
  apiWrite: number;
  mcpRead: number;
  mcpWrite: number;
  // Attachments they uploaded that are still stored (any time).
  storedBytes: number;
  // Last day with any counted use (any time); null: none counted.
  lastActive: string | null;
};

export type ViaActivity = {
  kind: "key" | "app";
  // The key's prefix or the app's name; null when it's gone.
  label: string | null;
  owners: string[];
  channels: ("API" | "MCP")[];
  read: number;
  write: number;
};

export type ToolActivity = { tool: string; write: boolean; calls: number; people: number };

export type ActivityStats = {
  days: DayActivity[];
  people: PersonActivity[];
  via: ViaActivity[];
  tools: ToolActivity[];
  totals: { web: number; api: number; mcp: number; pagesCreated: number; chatMessages: number; activePeople: number };
};

// Midnight (server time) `days - 1` days ago: the period includes today.
function periodStart(days: number): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

// A Date column (UsageDaily.day) for a server-time day.
const dateColumn = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export async function activityStats(period: UsagePeriod): Promise<ActivityStats> {
  const start = periodStart(period);
  const since = dateColumn(usageDay(start));
  const [byPerson, byDay, activeDays, viaRows, toolRows, toolPeople, created, chats, stored, lastActive] = await Promise.all([
    prisma.usageDaily.groupBy({ by: ["userId", "channel", "metric"], where: { day: { gte: since } }, _sum: { count: true } }),
    prisma.usageDaily.groupBy({
      by: ["day", "channel"],
      where: { day: { gte: since }, metric: { in: ["edit", "read", "write"] } },
      _sum: { count: true },
    }),
    prisma.usageDaily.groupBy({ by: ["day", "userId"], where: { day: { gte: since } } }),
    prisma.usageDaily.groupBy({
      by: ["via", "channel", "metric", "userId"],
      where: { day: { gte: since }, channel: { in: ["API", "MCP"] } },
      _sum: { count: true },
    }),
    prisma.usageDaily.groupBy({ by: ["detail", "metric"], where: { day: { gte: since }, channel: "MCP" }, _sum: { count: true } }),
    prisma.usageDaily.groupBy({ by: ["detail", "userId"], where: { day: { gte: since }, channel: "MCP" } }),
    prisma.page.groupBy({ by: ["createdById"], where: { createdAt: { gte: start } }, _count: true }),
    prisma.chatMessage.groupBy({ by: ["authorId"], where: { createdAt: { gte: start }, authorId: { not: null } }, _count: true }),
    prisma.fileObject.groupBy({ by: ["uploadedById"], where: { uploadedById: { not: null } }, _sum: { size: true } }),
    prisma.usageDaily.groupBy({ by: ["userId"], _max: { day: true } }),
  ]);

  // Every day of the period, so quiet days show as zero.
  const days = new Map<string, DayActivity>();
  for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const day = usageDay(d);
    days.set(day, { day, web: 0, api: 0, mcp: 0, people: 0 });
  }
  for (const row of byDay) {
    const entry = days.get(dayOf(row.day));
    if (!entry) continue;
    const key = row.channel === "WEB" ? "web" : row.channel === "API" ? "api" : "mcp";
    entry[key] += n(row._sum.count);
  }
  for (const row of activeDays) {
    const entry = days.get(dayOf(row.day));
    if (entry) entry.people++;
  }

  // People: anyone with a count, a page or a message in the period.
  type Counts = Omit<PersonActivity, "userId" | "name" | "disabled" | "storedBytes" | "lastActive">;
  const empty = (): Counts => ({ edits: 0, pagesCreated: 0, chatMessages: 0, uploads: 0, uploadBytes: 0, apiRead: 0, apiWrite: 0, mcpRead: 0, mcpWrite: 0 });
  const counts = new Map<string, Counts>();
  const of = (userId: string) => {
    let c = counts.get(userId);
    if (!c) counts.set(userId, (c = empty()));
    return c;
  };
  for (const row of byPerson) {
    const c = of(row.userId);
    const value = n(row._sum.count);
    if (row.channel === "WEB" && row.metric === "edit") c.edits += value;
    else if (row.metric === "upload") c.uploads += value;
    else if (row.metric === "uploadBytes") c.uploadBytes += value;
    else if (row.channel === "API") c[row.metric === "write" ? "apiWrite" : "apiRead"] += value;
    else if (row.channel === "MCP") c[row.metric === "write" ? "mcpWrite" : "mcpRead"] += value;
  }
  for (const row of created) of(row.createdById).pagesCreated += row._count;
  for (const row of chats) if (row.authorId) of(row.authorId).chatMessages += row._count;

  const storedOf = new Map(stored.map((r) => [r.uploadedById!, n(r._sum.size)]));
  const lastOf = new Map(lastActive.map((r) => [r.userId, r._max.day ? dayOf(r._max.day) : null]));
  const viaOwners = new Set(viaRows.map((r) => r.userId));
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set([...counts.keys(), ...viaOwners])] } },
    select: { id: true, name: true, emailEnc: true, disabledAt: true },
  });
  const nameOf = new Map(await Promise.all(users.map(async (u) => [u.id, await displayName(u)] as const)));
  const disabled = new Set(users.filter((u) => u.disabledAt).map((u) => u.id));

  const total = (c: Counts) => c.edits + c.pagesCreated + c.chatMessages + c.uploads + c.apiRead + c.apiWrite + c.mcpRead + c.mcpWrite;
  const people: PersonActivity[] = [...counts]
    .filter(([userId]) => nameOf.has(userId))
    .sort(([, a], [, b]) => total(b) - total(a))
    .map(([userId, c]) => ({
      userId,
      name: nameOf.get(userId)!,
      disabled: disabled.has(userId),
      ...c,
      storedBytes: storedOf.get(userId) ?? 0,
      lastActive: lastOf.get(userId) ?? null,
    }));

  // API keys and connected apps.
  const keyIds = [...new Set(viaRows.filter((r) => r.via.startsWith("key:")).map((r) => r.via.slice(4)))];
  const appIds = [...new Set(viaRows.filter((r) => r.via.startsWith("app:")).map((r) => r.via.slice(4)))];
  const [keys, apps] = await Promise.all([
    prisma.apiKey.findMany({ where: { id: { in: keyIds } }, select: { id: true, prefix: true } }),
    prisma.oAuthClient.findMany({ where: { id: { in: appIds } }, select: { id: true, name: true } }),
  ]);
  const prefixOf = new Map(keys.map((k) => [k.id, k.prefix]));
  const appName = new Map(apps.map((a) => [a.id, a.name]));
  const viaMap = new Map<string, ViaActivity & { ownerIds: Set<string> }>();
  for (const row of viaRows) {
    if (!row.via) continue;
    let entry = viaMap.get(row.via);
    if (!entry) {
      const isKey = row.via.startsWith("key:");
      const id = row.via.slice(4);
      entry = {
        kind: isKey ? "key" : "app",
        label: (isKey ? prefixOf.get(id) : appName.get(id)) ?? null,
        owners: [],
        ownerIds: new Set(),
        channels: [],
        read: 0,
        write: 0,
      };
      viaMap.set(row.via, entry);
    }
    entry.ownerIds.add(row.userId);
    const channel = row.channel as "API" | "MCP";
    if (!entry.channels.includes(channel)) entry.channels.push(channel);
    entry[row.metric === "write" ? "write" : "read"] += n(row._sum.count);
  }
  const via = [...viaMap.values()]
    .map(({ ownerIds, ...v }) => ({ ...v, owners: [...ownerIds].map((id) => nameOf.get(id) ?? "").filter(Boolean), channels: v.channels.sort() }))
    .sort((a, b) => b.read + b.write - (a.read + a.write));

  const peopleOfTool = new Map<string, number>();
  for (const row of toolPeople) peopleOfTool.set(row.detail, (peopleOfTool.get(row.detail) ?? 0) + 1);
  const tools: ToolActivity[] = toolRows
    .map((r) => ({ tool: r.detail, write: r.metric === "write", calls: n(r._sum.count), people: peopleOfTool.get(r.detail) ?? 0 }))
    .sort((a, b) => b.calls - a.calls);

  const dayList = [...days.values()];
  return {
    days: dayList,
    people,
    via,
    tools,
    totals: {
      web: dayList.reduce((s, d) => s + d.web, 0),
      api: dayList.reduce((s, d) => s + d.api, 0),
      mcp: dayList.reduce((s, d) => s + d.mcp, 0),
      pagesCreated: people.reduce((s, p) => s + p.pagesCreated, 0),
      chatMessages: people.reduce((s, p) => s + p.chatMessages, 0),
      activePeople: people.length,
    },
  };
}
