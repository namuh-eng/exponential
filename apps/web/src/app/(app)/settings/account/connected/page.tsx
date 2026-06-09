import { redirect } from "next/navigation";

export default function LegacyConnectedAccountsPage() {
  redirect("/settings/account/connections");
}
