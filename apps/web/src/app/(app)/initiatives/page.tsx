import { getInitiatives } from "@/lib/initiatives-list";
import { getWebSession } from "@/lib/web-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { InitiativesClient } from "./initiatives-client";

export default async function InitiativesPage() {
  const session = await getWebSession(await headers());
  if (!session) {
    redirect("/login");
  }

  const initialData = await getInitiatives(session.user.id);

  return <InitiativesClient initialData={initialData} />;
}
