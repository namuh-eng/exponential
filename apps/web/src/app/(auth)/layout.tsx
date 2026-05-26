export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-shell flex min-h-screen flex-col items-stretch font-mono">
      {children}
    </div>
  );
}
