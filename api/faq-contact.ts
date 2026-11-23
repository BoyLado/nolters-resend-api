import type { VercelRequest, VercelResponse } from "@vercel/node";

function escapeHtml(value: string): string {
  const characters: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return value.replace(/[&<>"']/g, (character) => characters[character]);
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Origin");

  const allowedOrigins = (process.env.CONTACT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const origin = request.headers.origin;

  if (typeof origin !== "string" || !allowedOrigins.includes(origin)) {
    return response.status(403).json({
      ok: false,
      error: "origin_not_allowed",
    });
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");

    return response.status(405).json({
      ok: false,
      error: "method_not_allowed",
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = process.env.CONTACT_TO_EMAIL;

  if (!apiKey || !from || !to) {
    return response.status(500).json({
      ok: false,
      error: "configuration_error",
    });
  }

  const contentType = request.headers["content-type"] || "";

  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json") {
    return response.status(415).json({
      ok: false,
      error: "invalid_content_type",
    });
  }

  try {
    let body: unknown = request.body;

    if (typeof body === "string") {
      if (Buffer.byteLength(body, "utf8") > 20000) {
        return response.status(413).json({
          ok: false,
          error: "request_too_large",
        });
      }

      try {
        body = JSON.parse(body);
      } catch {
        return response.status(400).json({
          ok: false,
          error: "invalid_json",
        });
      }
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return response.status(400).json({
        ok: false,
        error: "invalid_request",
      });
    }

    if (Buffer.byteLength(JSON.stringify(body), "utf8") > 20000) {
      return response.status(413).json({
        ok: false,
        error: "request_too_large",
      });
    }

    const data = body as Record<string, unknown>;

    if (data.website !== undefined && typeof data.website !== "string") {
      return response.status(400).json({
        ok: false,
        error: "invalid_fields",
      });
    }

    // Honeypot: silently accept submissions from likely bots.
    if (typeof data.website === "string" && data.website.trim()) {
      return response.status(200).json({ ok: true });
    }

    const name = typeof data.name === "string" ? data.name.trim() : "";
    const email = typeof data.email === "string" ? data.email.trim() : "";
    const message =
      typeof data.message === "string" ? data.message.trim() : "";

    if (
      !name ||
      name.length > 100 ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      /[\r\n]/.test(email) ||
      !message ||
      message.length > 5000
    ) {
      return response.status(400).json({
        ok: false,
        error: "invalid_fields",
      });
    }

    // Encode special characters while keeping the address's @ readable.
    const recipient = encodeURIComponent(email).replace(/%40/gi, "@");
    const replyUrl =
      `mailto:${recipient}?subject=` +
      encodeURIComponent("Re: Your FAQ inquiry");

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeReplyUrl = escapeHtml(replyUrl);
    const safeMessage = escapeHtml(message).replace(/\r\n|\r|\n/g, "<br>");

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: "New FAQ assistant inquiry",

        text: [
          "New FAQ assistant inquiry",
          "",
          `Name: ${name}`,
          `Email: ${email}`,
          "",
          "Question asked in FAQ assistant:",
          message,
        ].join("\n"),

        html: `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>New FAQ assistant inquiry</title>
            </head>

            <body style="margin:0;padding:0;background-color:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#242424;">
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="background-color:#f4f2ee;"
              >
                <tr>
                  <td align="center" style="padding:32px 12px;">
                    <table
                      role="presentation"
                      width="100%"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="max-width:600px;background-color:#ffffff;border:1px solid #e7e2d9;border-radius:16px;"
                    >
                      <tr>
                        <td style="padding:32px 24px;background-color:#242424;border-radius:16px 16px 0 0;">
                          <p style="margin:0 0 12px;color:#dfc58e;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">
                            FAQ assistant
                          </p>

                          <h1 style="margin:0;color:#ffffff;font-size:28px;line-height:1.3;">
                            New customer inquiry
                          </h1>

                          <p style="margin:12px 0 0;color:#dedede;font-size:14px;line-height:1.6;">
                            A customer submitted a question through your store’s FAQ assistant.
                          </p>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:28px 24px;">
                          <h2 style="margin:0 0 16px;color:#777064;font-size:12px;letter-spacing:1px;text-transform:uppercase;">
                            Customer details
                          </h2>

                          <p style="margin:0 0 12px;font-size:15px;line-height:1.7;overflow-wrap:anywhere;word-break:break-word;">
                            <strong>Name:</strong> ${safeName}
                          </p>

                          <p style="margin:0;font-size:15px;line-height:1.7;overflow-wrap:anywhere;word-break:break-word;">
                            <strong>Email:</strong>
                            <a
                              href="${safeReplyUrl}"
                              style="color:#675020;text-decoration:underline;"
                            >${safeEmail}</a>
                          </p>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:0 24px 28px;">
                          <table
                            role="presentation"
                            width="100%"
                            cellspacing="0"
                            cellpadding="0"
                            border="0"
                            style="table-layout:fixed;"
                          >
                            <tr>
                              <td style="padding:20px;background-color:#f8f6f2;border-left:3px solid #a18449;border-radius:4px;">
                                <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">
                                  <strong>Question asked in FAQ assistant:</strong>
                                </p>

                                <p style="margin:0;font-size:15px;line-height:1.8;overflow-wrap:anywhere;word-break:break-word;">
                                  ${safeMessage}
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:0 24px 32px;">
                          <table
                            role="presentation"
                            cellspacing="0"
                            cellpadding="0"
                            border="0"
                          >
                            <tr>
                              <td
                                align="center"
                                bgcolor="#242424"
                                style="border-radius:8px;"
                              >
                                <a
                                  href="${safeReplyUrl}"
                                  style="display:inline-block;padding:15px 24px;border:1px solid #242424;border-radius:8px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;"
                                >
                                  Reply to customer &rarr;
                                </a>
                              </td>
                            </tr>
                          </table>

                          <p style="margin:16px 0 0;color:#767676;font-size:12px;line-height:1.7;overflow-wrap:anywhere;">
                            Reply to ${safeEmail}, or use your inbox’s Reply button.
                          </p>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:20px 0 0;color:#767676;font-size:12px;line-height:1.6;">
                      Sent from your store’s FAQ assistant.
                    </p>
                  </td>
                </tr>
              </table>
            </body>
          </html>
        `,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!emailResponse.ok) {
      console.error("Contact email delivery failed", emailResponse.status);

      return response.status(502).json({
        ok: false,
        error: "delivery_failed",
      });
    }

    return response.status(200).json({ ok: true });
  } catch {
    console.error("Contact request failed");

    return response.status(500).json({
      ok: false,
      error: "request_failed",
    });
  }
}