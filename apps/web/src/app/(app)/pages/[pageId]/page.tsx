import { notFound } from "next/navigation";
import { findAccessiblePage } from "@/lib/auth/pages";
import { requireUser } from "@/lib/auth/session";
import { EditorLoader } from "./editor-loader";

export default async function PageEditorRoute({ params }: PageProps<"/pages/[pageId]">) {
  const { pageId } = await params;
  const user = await requireUser(`/pages/${encodeURIComponent(pageId)}`);
  const page = await findAccessiblePage(user.id, pageId);
  if (!page) notFound();

  return (
    <EditorLoader
      pageId={page.id}
      readOnly={page.role === "GUEST"}
      user={{ id: user.id, name: user.name ?? user.email }}
    />
  );
}
