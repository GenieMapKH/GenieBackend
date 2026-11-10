/** What the email says about the device that just signed in. */
export interface SignInAlertDetails {
  deviceName: string | null;
  platform: string | null;
  ipAddress: string | null;
  signedInAt: Date;
}

export const SIGN_IN_ALERT_SUBJECT = 'New sign-in to your Tilomnov account';

/** The device describes itself, so its words are never trusted as HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label: string, value: string): string {
  return `<tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #64748B; width: 96px;">${label}</td>
                  <td style="padding: 6px 0; font-size: 14px; color: #0F172A; font-weight: 600;">${escapeHtml(value)}</td>
                </tr>`;
}

/** HTML body of the "someone signed in to your account" email. */
export function signInAlertEmailHtml(details: SignInAlertDetails): string {
  const device =
    [details.deviceName, details.platform].filter(Boolean).join(', ') ||
    'Unknown device';
  const time = `${details.signedInAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${SIGN_IN_ALERT_SUBJECT}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F1F5F9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background-color: #FFFFFF; border-radius: 20px; overflow: hidden; border: 1px solid #E2E8F0;">
          <tr>
            <td style="padding: 36px 40px 16px; text-align: center;">
              <span style="font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #0F172A;">GENIE</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px;">
              <h1 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #0F172A; text-align: center;">New sign-in to your account</h1>
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 24px; color: #475569; text-align: center;">
                Another device just signed in to your Tilomnov account while you were signed in elsewhere.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 24px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 16px;">
                ${row('Device', device)}
                ${row('Time', time)}
                ${details.ipAddress ? row('IP address', details.ipAddress) : ''}
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #FFFBEB; border-left: 4px solid #F59E0B; border-radius: 8px;">
                <tr>
                  <td style="padding: 14px 16px;">
                    <p style="margin: 0; font-size: 13px; line-height: 20px; color: #92400E;">
                      <strong>Not you?</strong> Open Tilomnov on a device you trust, go to
                      User &gt; Security &gt; Logged-in devices, sign that device out, then change your password.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px 28px; text-align: center; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0; font-size: 11px; color: #94A3B8;">
                This is an automated security message. If this was you, nothing needs to be done.
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
