import { InboxClient } from "@/components/inbox-client";

export default async function InboxNotificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InboxClient initialSelectedId={id} />;
}
