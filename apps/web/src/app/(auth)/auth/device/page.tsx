import { DeviceAuthPage } from "@/components/device-auth-page";
import { getWebSession } from "@/lib/web-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const params = await searchParams;
  const userCode = params.user_code ?? "";
  const headerList = await headers();
  const session = await getWebSession(headerList);
  if (!session) {
    const callback = `/auth/device${userCode ? `?user_code=${encodeURIComponent(userCode)}` : ""}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(callback)}`);
  }
  return (
    <DeviceAuthPage initialUserCode={userCode} userName={session.user.name} />
  );
}
