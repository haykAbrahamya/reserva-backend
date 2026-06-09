interface ActivationOpts {
  name: string;
  company: string;
  link: string;
}

/**
 * Branded activation email. Inline styles only (email clients strip <style>),
 * table-based layout for maximum client compatibility, with a plain-text
 * fallback. Brand: warm dark ink + Reserva accent.
 */
export function activationEmail({ name, company, link }: ActivationOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Activate your Reserva account';
  const accent = '#A8784B';
  const ink = '#14110E';
  const muted = '#6E665B';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#FAFAF7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid rgba(20,17,14,0.08);border-radius:16px;overflow:hidden;">
            <!-- Header -->
            <tr>
              <td style="padding:32px 36px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:40px;height:40px;background:${accent};border-radius:10px;text-align:center;vertical-align:middle;color:#fff;font-size:20px;font-weight:700;">R</td>
                    <td style="padding-left:12px;font-size:20px;font-weight:600;color:${ink};letter-spacing:-0.02em;">Reserva</td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:20px 36px 8px;">
                <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:${ink};letter-spacing:-0.02em;">Welcome, ${escapeHtml(name)} 👋</h1>
                <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:${muted};">
                  Your <strong style="color:${ink};">${escapeHtml(company)}</strong> account is almost ready.
                  Click the button below to activate it and sign in to your dashboard.
                </p>
              </td>
            </tr>
            <!-- CTA -->
            <tr>
              <td style="padding:20px 36px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td align="center" style="border-radius:10px;background:${accent};">
                      <a href="${link}" target="_blank"
                         style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Activate &amp; sign in →
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Fallback link -->
            <tr>
              <td style="padding:16px 36px 8px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${muted};">
                  Or paste this link into your browser:<br>
                  <a href="${link}" style="color:${accent};word-break:break-all;">${link}</a>
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:24px 36px 32px;border-top:1px solid rgba(20,17,14,0.06);margin-top:16px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#9C9484;">
                  This link expires in 24 hours. If you didn't request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-size:11px;color:#9C9484;text-align:center;">
            © Reserva — booking platform for salons &amp; studios.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Welcome, ${name}!`,
    ``,
    `Your ${company} account is almost ready. Activate it and sign in:`,
    link,
    ``,
    `This link expires in 24 hours. If you didn't request this, ignore this email.`,
    `— Reserva`,
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
