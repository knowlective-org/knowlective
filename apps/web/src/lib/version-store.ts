import { type PrismaClient, decrypt } from "shared";
import { versionAad } from "./page-versions";
import { versionState } from "./version-chain";

// A saved version's whole state, read through its chain of differences
// (version-chain.ts), for the collab server and the app. Versions of other
// pages aren't followed.
export function storedVersionState(
  prisma: Pick<PrismaClient, "pageVersion">,
  key: Buffer,
  pageId: string,
  versionId: string,
): Promise<Uint8Array> {
  return versionState(
    versionId,
    (id) => prisma.pageVersion.findFirst({ where: { id, pageId }, select: { id: true, baseId: true, state: true } }),
    (row) => Uint8Array.from(decrypt(key, row.state, versionAad(pageId, row.id))),
  );
}
