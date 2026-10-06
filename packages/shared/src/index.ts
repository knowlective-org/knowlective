import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export { PrismaClient, Prisma } from "@prisma/client";
export type {
  User,
  KnowledgeRoot,
  Page,
  PageDocument,
  PageAccess,
  PageGrant,
  AuditLog,
  SiteRole,
  InstanceConfig,
  AdminSession,
  AdminSessionStage,
  AdminLoginAttempt,
  UserSession,
  Invitation,
  UserLoginAttempt,
  MailSettings,
  SmtpSecurity,
  Group,
  GroupMember,
  StorageSettings,
  FileObject,
  PagePropertyDef,
  PagePropertyValue,
  PropertyType,
  ThemeSettings,
  PageVersion,
  PageVersionKind,
  PageSearchIndex,
} from "@prisma/client";
export { encrypt, decrypt, generateKey, parseServerKey } from "./crypto";
export { createKnowledgeRoot } from "./knowledge-root";
export {
  ACCESS_RANK,
  ALL_USERS_GROUP,
  MAX_PAGE_DEPTH,
  type VisiblePage,
  type VisibleTree,
  atLeast,
  computeTreeAccess,
  getGroupAccessForPage,
  getPageAccess,
  getTrash,
  getTreeWithAccess,
  type TrashItem,
  type RestoreDestination,
  restoreDestinations,
  getUsersWithPageAccess,
  getVisibleTree,
  getVisibleTrees,
} from "./permissions";
export {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from "./password";
export {
  COLLAB_TOKEN_TTL_SECONDS,
  type CollabTokenPayload,
  createCollabToken,
  verifyCollabToken,
} from "./collab-token";
export { InvalidPublicUrlError, isInsecurePublicUrl, normalizePublicUrl } from "./public-url";
export {
  MIN_MASTER_PASSWORD_LENGTH,
  InstanceNotSetUpError,
  InstanceAlreadySetUpError,
  isSetupComplete,
  setupInstance,
  verifyMasterPassword,
  rewrapWithServerKey,
  loadDataKey,
} from "./instance";

// Prisma 7 has no bundled query engine binary — every PrismaClient needs an
// explicit driver adapter. Each process (apps/web, apps/collab) should call
// this once and reuse the instance rather than constructing PrismaClient directly.
export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create a PrismaClient");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
