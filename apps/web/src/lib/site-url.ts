import { BASE_PATH } from "@/lib/base-path";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/request";

// Base URL for links that leave the site (emails, invitation links): the
// configured origin plus the base path the app is served under, without a
// trailing slash ("https://example.com/yosuga").
// Falls back to the request's origin on instances set up before the setting
// existed; /admin shows a warning until it's configured.
export async function getPublicUrl(): Promise<string> {
  const config = await prisma.instanceConfig.findUnique({
    where: { id: 1 },
    select: { publicUrl: true },
  });
  return `${config?.publicUrl ?? (await getRequestOrigin())}${BASE_PATH}`;
}
