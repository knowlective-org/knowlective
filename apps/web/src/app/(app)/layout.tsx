import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { RefreshOnReturn } from "@/components/refresh-on-return";

// Every app screen requires first-run setup (master password + data key).
// Until then, send all visitors to /setup.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  if (!(await isSetupComplete(prisma))) {
    redirect("/setup");
  }
  return (
    <>
      <RefreshOnReturn />
      {children}
    </>
  );
}
