import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { fetchPublicJson } from "@/lib/link-preview";
import { loadOutboundProxy } from "@/lib/outbound-proxy";
import { type ClientInfo, type ClientMetadataError, isClientMetadataUrl, parseClientMetadata } from "./params";

// The apps that may ask people to connect them (lib/oauth/), two ways:
// - registration (RFC 7591): the app posts its metadata to /oauth/register
//   and gets an id of ours ("knc_…"). Anyone can register, so registrations
//   are limited per network address and removed when never used;
// - a Client ID Metadata Document: the app's id is an https URL, and the
//   document there names it and its redirect URIs. Fetched when someone
//   connects (as link previews are fetched: public addresses only, through
//   the outbound proxy), and kept for an hour.
// Neither proves who the app is: the consent screen says so.

export const CLIENT_ID_PREFIX = "knc_";
const METADATA_TTL_MS = 60 * 60 * 1000;
const MAX_METADATA_BYTES = 16 * 1024;
// A registration nobody connected with is removed after a day; one whose
// connections are all gone, after 90 days unused.
const UNUSED_REGISTRATION_MS = 24 * 60 * 60 * 1000;
const IDLE_REGISTRATION_MS = 90 * 24 * 60 * 60 * 1000;

export type OAuthClientView = ClientInfo & { id: string };

// Registers an app (the registration endpoint). Returns its id, or what's
// wrong with the metadata.
export async function registerClient(metadata: unknown): Promise<OAuthClientView | ClientMetadataError> {
  const info = parseClientMetadata(metadata);
  if ("error" in info) return info;
  await removeUnusedClients();
  const id = CLIENT_ID_PREFIX + randomBytes(16).toString("base64url");
  await prisma.oAuthClient.create({
    data: { id, kind: "REGISTERED", name: info.name, redirectUris: info.redirectUris, clientUri: info.clientUri },
  });
  return { id, ...info };
}

async function removeUnusedClients() {
  const now = Date.now();
  await prisma.oAuthClient.deleteMany({
    where: {
      kind: "REGISTERED",
      OR: [
        { lastUsedAt: null, createdAt: { lt: new Date(now - UNUSED_REGISTRATION_MS) } },
        { lastUsedAt: { lt: new Date(now - IDLE_REGISTRATION_MS) }, grants: { none: {} } },
      ],
    },
  });
}

// The app with this id, as it's known now: a registered one from the
// database, a metadata document fetched again when older than an hour (the
// last good copy is kept when it can't be fetched). null: unknown.
export async function findClient(clientId: unknown): Promise<OAuthClientView | null> {
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > 2000) return null;
  const row = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
  if (row?.kind === "REGISTERED") return view(row);
  if (!isClientMetadataUrl(clientId)) return null;
  if (row && row.fetchedAt && Date.now() - row.fetchedAt.getTime() < METADATA_TTL_MS) return view(row);

  const document = await fetchPublicJson(clientId, await loadOutboundProxy(prisma), MAX_METADATA_BYTES);
  const info = document === null ? null : parseClientMetadata(document, clientId);
  if (!info || "error" in info) return row ? view(row) : null;
  const data = { name: info.name, redirectUris: info.redirectUris, clientUri: info.clientUri, fetchedAt: new Date() };
  const saved = await prisma.oAuthClient.upsert({
    where: { id: clientId },
    create: { id: clientId, kind: "METADATA_URL", ...data },
    update: data,
  });
  return view(saved);
}

function view(row: { id: string; name: string; redirectUris: string[]; clientUri: string | null }): OAuthClientView {
  return { id: row.id, name: row.name, redirectUris: row.redirectUris, clientUri: row.clientUri };
}
