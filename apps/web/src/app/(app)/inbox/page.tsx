import { InboxClient } from "@/components/inbox-client";
import { getInboxNotifications } from "@/lib/inbox-notifications";
import { getWebSession } from "@/lib/web-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function InboxPage() {
  const session = await getWebSession(await headers());
  if (!session) {
    redirect("/login");
  }

  const initialNotifications = await getInboxNotifications(session.user.id);

  return <InboxClient initialNotifications={initialNotifications} />;
}
