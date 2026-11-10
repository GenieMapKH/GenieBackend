import { OTP_TTL_MINUTES } from '../auth.constants';

export function otpEmailSubject(otp: string): string {
  return `${otp} is your Tilomnov verification code`;
}

/** HTML body of the password-reset code email. */
export function otpEmailHtml(
  otp: string,
  purpose: 'reset' | 'verification' = 'reset',
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${purpose === 'reset' ? 'Password Reset' : 'Email'} Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F1F5F9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background-color: #FFFFFF; border-radius: 20px; overflow: hidden; border: 1px solid #E2E8F0;">
          <tr>
            <td style="height: 6px; background: linear-gradient(90deg, #4F46E5 0%, #7C3AED 50%, #EC4899 100%);"></td>
          </tr>
          <tr>
            <td style="padding: 36px 40px 24px; text-align: center;">
              <span style="font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #0F172A;">GENIE</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px;">
              <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #0F172A; text-align: center;">Password Reset Code</h1>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 24px; color: #475569; text-align: center;">
                ${purpose === 'reset' ? 'We received a request to reset the password for your Tilomnov account. Use the 6-digit verification code below to complete your reset:' : 'Use the 6-digit code below to verify this email address for your Tilomnov account:'}
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 24px; background: #F8FAFC; border: 1.5px dashed #CBD5E1; border-radius: 16px; text-align: center;">
                <tr>
                  <td style="padding: 24px 16px;">
                    <div style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 12px; color: #4F46E5; padding-left: 12px;">${otp}</div>
                    <div style="margin-top: 10px; display: inline-block; background-color: #EEF2FF; color: #4338CA; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px;">
                      Valid for ${OTP_TTL_MINUTES} minutes
                    </div>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #FFFBEB; border-left: 4px solid #F59E0B; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 14px 16px;">
                    <p style="margin: 0; font-size: 13px; line-height: 20px; color: #92400E;">
                      <strong>Security Tip:</strong> Never share this code with anyone. Tilomnov team members will never ask for your verification code or password.
                    </p>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 14px; line-height: 22px; color: #64748B; text-align: center;">
                If you did not request this code, please ignore this email or contact support if you have security concerns.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 32px; text-align: center; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0 0 6px; font-size: 12px; color: #94A3B8; font-weight: 500;">
                © 2026 Tilomnov Real Estate &amp; Property Marketplace. All rights reserved.
              </p>
              <p style="margin: 0; font-size: 11px; color: #CBD5E1;">
                This is an automated security message. Please do not reply directly to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
