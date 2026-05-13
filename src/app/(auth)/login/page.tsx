import { AuthPage } from "@/components/auth-page";

export const dynamic = "force-static";

export default function LoginPage() {
  return <AuthPage mode="login" />;
}
