import { AuthPage } from "@/components/auth-page";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <AuthPage mode="login" />;
}
