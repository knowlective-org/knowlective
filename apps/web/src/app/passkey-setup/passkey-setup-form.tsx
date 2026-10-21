"use client";

import { useRouter } from "next/navigation";
import { PasskeyRegisterForm } from "@/components/passkey-register-form";

// Registers the passkey, then goes where the person was headed.
export function PasskeySetupForm({ next }: { next: string }) {
  const router = useRouter();
  return <PasskeyRegisterForm onRegistered={() => router.replace(next)} />;
}
