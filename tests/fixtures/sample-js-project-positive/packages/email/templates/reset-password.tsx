// Email template: resetLink default param is preview-only fallback; real URL always passed by caller.
function ResetPasswordEmail({
  userName,
  resetLink = 'https://app.example.com/auth/reset-password?token=preview',
}: {
  userName: string;
  resetLink?: string;
}) {
  return (
    <div>
      <p>Hi {userName}, click below to reset your password.</p>
      <a href={resetLink}>Reset Password</a>
    </div>
  );
}
export { ResetPasswordEmail };
