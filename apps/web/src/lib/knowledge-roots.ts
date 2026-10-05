import { prisma } from "@/lib/db";

// A knowledge root ("ナレッジルート") is shown in the UI as its root page; its
// display name is the root page's title. See KnowledgeRoot in schema.prisma.

// Upper bound on page nesting (root page = depth 0). A safety limit against
// runaway trees, far beyond normal use; enforced when pages are created/moved.
export const MAX_PAGE_DEPTH = 50;

export const rootNameSelect = { rootPage: { select: { title: true } } } as const;

export function rootName(root: { rootPage: { title: string } | null }): string {
  return root.rootPage?.title ?? "（名称未設定）";
}

export async function listKnowledgeRoots(): Promise<{ id: string; name: string }[]> {
  const roots = await prisma.knowledgeRoot.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, ...rootNameSelect },
  });
  return roots.map((r) => ({ id: r.id, name: rootName(r) }));
}
