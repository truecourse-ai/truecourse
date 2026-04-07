/**
 * Email template rendering engine.
 * Contains magic strings and various code quality issues that real template code has.
 */

export class EmailTemplates {
  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  render(subject: string, body: string) {
    // VIOLATION: code-quality/deterministic/magic-string
    const contentType = 'text/html; charset=utf-8';
    // VIOLATION: code-quality/deterministic/magic-string
    const contentType2 = 'text/html; charset=utf-8';
    // VIOLATION: code-quality/deterministic/magic-string
    const contentType3 = 'text/html; charset=utf-8';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${subject}</title>
        </head>
        <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto;">
            <h1>${subject}</h1>
            <div>${body}</div>
            <hr>
            <p style="color: #666; font-size: 12px;">
              This is an automated notification. Do not reply.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  renderWelcome(userName: string) {
    return `
      <p>Hello ${userName},</p>
      <p>Welcome to our platform. Your account has been created successfully.</p>
      <p>Best regards,<br>The Team</p>
    `;
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  renderPasswordReset(resetLink: string) {
    return `
      <p>You requested a password reset.</p>
      <p>Click the link below to reset your password:</p>
      <a href="${resetLink}">Reset Password</a>
      <p>This link expires in 24 hours.</p>
    `;
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  renderAlert(level: string, message: string) {
    const colors: Record<string, string> = {
      info: '#2196F3',
      warning: '#FF9800',
      error: '#F44336',
      critical: '#9C27B0',
    };

    const color = colors[level] || '#333';

    return `
      <div style="border-left: 4px solid ${color}; padding: 12px; margin: 16px 0;">
        <strong style="color: ${color};">${level.toUpperCase()}</strong>
        <p>${message}</p>
      </div>
    `;
  }
}
