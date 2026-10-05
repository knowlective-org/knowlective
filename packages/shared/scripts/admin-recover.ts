import path from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { createPrismaClient, verifyMasterPassword } from "../src/index";
import { promptHidden } from "./prompt";

// Recovery for an admin locked out of /admin. Requires shell access to the
// server AND the master password.
//   pnpm admin:recover --reset-totp          lost the master login's authenticator app
//   pnpm admin:recover --reset-user-totp=<email>  a site admin lost their authenticator app
//   pnpm admin:recover --clear-ip-allowlist  IP restriction locks you out
//   pnpm admin:recover --clear-lockout       forget failed login attempts
// Every option also ends all admin sessions.

const OPTIONS = ["--reset-totp", "--clear-ip-allowlist", "--clear-lockout"] as const;

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const userTotpEmails = args
    .filter((a) => a.startsWith("--reset-user-totp="))
    .map((a) => a.slice("--reset-user-totp=".length).trim().toLowerCase());
  const unknown = args.filter(
    (a) => !(OPTIONS as readonly string[]).includes(a) && !a.startsWith("--reset-user-totp="),
  );
  if (args.length === 0 || unknown.length > 0 || userTotpEmails.some((e) => !e)) {
    console.error(`Usage: pnpm admin:recover [${OPTIONS.join("] [")}] [--reset-user-totp=<email>]`);
    process.exit(1);
  }

  const prisma = createPrismaClient();
  const masterPassword = await promptHidden("Master password: ");
  if (!(await verifyMasterPassword(prisma, masterPassword))) {
    throw new Error("Master password is incorrect");
  }

  if (args.includes("--reset-totp")) {
    await prisma.instanceConfig.update({
      where: { id: 1 },
      data: { totpSecret: null, totpLastStep: null },
    });
    console.log("Authenticator removed. The next admin login will enroll a new one.");
  }
  for (const email of userTotpEmails) {
    const { count } = await prisma.user.updateMany({
      where: { email },
      data: { totpSecret: null, totpLastStep: null },
    });
    console.log(
      count === 1
        ? `Authenticator removed for ${email}. Their next admin login will enroll a new one.`
        : `No user with email ${email}.`,
    );
  }
  if (args.includes("--clear-ip-allowlist")) {
    await prisma.instanceConfig.update({ where: { id: 1 }, data: { adminIpAllowlist: [] } });
    console.log("Admin IP allowlist cleared.");
  }
  if (args.includes("--clear-lockout")) {
    await prisma.adminLoginAttempt.updateMany({
      where: { reason: "bad_credentials" },
      data: { reason: "bad_credentials_cleared" },
    });
    console.log("Login lockouts cleared.");
  }

  const { count } = await prisma.adminSession.deleteMany({});
  console.log(`Ended ${count} admin session(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
