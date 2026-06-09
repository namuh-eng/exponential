import {
  type AccountNotificationChannelKey,
  isAccountNotificationChannelKey,
} from "@/lib/account-notifications";
import { notFound } from "next/navigation";
import { NotificationChannelPage } from "../notifications-client";

export default async function NotificationChannelSettingsPage({
  params,
}: {
  params: Promise<{ channel: string }>;
}) {
  const { channel } = await params;

  if (!isAccountNotificationChannelKey(channel)) {
    notFound();
  }

  return (
    <NotificationChannelPage
      channel={channel as AccountNotificationChannelKey}
    />
  );
}
