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

function safeHttpsUrl(value: string): string {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
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

    // Honeypot: don't send email for likely bot submissions.
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

    const optionalFields: Record<string, number> = {
      product: 500,
      option: 500,
      sku: 200,
      productUrl: 2048,
    };

    for (const [field, limit] of Object.entries(optionalFields)) {
      const value = data[field];

      if (
        value !== undefined &&
        (typeof value !== "string" || value.length > limit)
      ) {
        return response.status(400).json({
          ok: false,
          error: "invalid_fields",
        });
      }
    }

    const product =
      typeof data.product === "string" ? data.product.trim() : "";

    const option =
      typeof data.option === "string" ? data.option.trim() : "";

    const sku = typeof data.sku === "string" ? data.sku.trim() : "";

    const productUrl =
      typeof data.productUrl === "string" ? data.productUrl.trim() : "";

    const safeUrl = safeHttpsUrl(productUrl);

    const recipient = encodeURIComponent(email).replace(/%40/gi, "@");

    const replyUrl =
      `mailto:${recipient}?subject=` +
      encodeURIComponent("Re: Your Nolters FAQ inquiry");

    const safeReplyUrl = escapeHtml(replyUrl);
    const safeEmail = escapeHtml(email);

    const messageHtml = escapeHtml(message).replace(
      /\r\n|\r|\n/g,
      "<br>",
    );

    const showProduct = Boolean(product || option || sku);

    const fieldRow = (label: string, value: string): string => `
      <p style="margin:0 0 12px;font-size:14px;line-height:1.7;overflow-wrap:anywhere;word-break:break-word;">
        <strong>${escapeHtml(label)}:</strong> ${escapeHtml(value || "—")}
      </p>
    `;

    const text = [
      "New FAQ assistant inquiry",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      "",
      "Question asked in FAQ assistant:",
      message,
      ...(showProduct
        ? [
            "",
            `Product: ${product || "—"}`,
            `Option: ${option || "—"}`,
            `SKU: ${sku || "—"}`,
          ]
        : []),
      ...(productUrl ? ["", `Page URL: ${productUrl}`] : []),
    ].join("\n");

    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New FAQ assistant inquiry</title>
        </head>

        <body style="margin:0;padding:0;background-color:#f5f1ea;font-family:Arial,Helvetica,sans-serif;color:#241d18;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f5f1ea;">
            <tr>
              <td align="center" style="padding:32px 12px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #ded7cd;border-radius:16px;">

                  <tr>
                    <td style="padding:32px 24px;background-color:#241d18;border-radius:16px 16px 0 0;">
                      <p style="margin:0 0 12px;color:#e1b29b;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">
                        Nolters · FAQ assistant
                      </p>

                      <h1 style="margin:0;color:#ffffff;font-size:28px;line-height:1.3;">
                        New customer inquiry
                      </h1>

                      <p style="margin:12px 0 0;color:#e5ded6;font-size:14px;line-height:1.7;">
                        A customer needs a little extra help.
                        Review their question and reply below.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:28px 24px 16px;">
                      <h2 style="margin:0 0 16px;color:#766e66;font-size:12px;letter-spacing:1px;text-transform:uppercase;">
                        Customer details
                      </h2>

                      ${fieldRow("Name", name)}

                      <p style="margin:0;font-size:14px;line-height:1.7;overflow-wrap:anywhere;word-break:break-word;">
                        <strong>Email:</strong>
                        <a href="${safeReplyUrl}" style="color:#85432f;text-decoration:underline;">
                          ${safeEmail}
                        </a>
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:12px 24px 28px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;">
                        <tr>
                          <td style="padding:20px;background-color:#f7f3eb;border-left:3px solid #a85b42;">
                            <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">
                              <strong>Question asked in FAQ assistant:</strong>
                            </p>

                            <p style="margin:0;font-size:15px;line-height:1.8;overflow-wrap:anywhere;word-break:break-word;">
                              ${messageHtml}
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  ${
                    showProduct || productUrl
                      ? `
                        <tr>
                          <td style="padding:24px;border-top:1px solid #eee8df;">
                            <h2 style="margin:0 0 16px;color:#766e66;font-size:12px;letter-spacing:1px;text-transform:uppercase;">
                              ${showProduct ? "Product details" : "Page details"}
                            </h2>

                            ${
                              showProduct
                                ? [
                                    fieldRow("Product", product),
                                    fieldRow("Option", option),
                                    fieldRow("SKU", sku),
                                  ].join("")
                                : ""
                            }

                            ${
                              productUrl
                                ? `
                                  <p style="margin:0;font-size:13px;line-height:1.8;overflow-wrap:anywhere;word-break:break-word;">
                                    <strong>${showProduct ? "Product URL" : "Page URL"}:</strong><br>
                                    ${
                                      safeUrl
                                        ? `<a href="${escapeHtml(safeUrl)}" style="color:#85432f;text-decoration:underline;">${escapeHtml(safeUrl)}</a>`
                                        : escapeHtml(productUrl)
                                    }
                                  </p>
                                `
                                : ""
                            }
                          </td>
                        </tr>
                      `
                      : ""
                  }

                  <tr>
                    <td style="padding:12px 24px 32px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td align="center" bgcolor="#241d18" style="border-radius:8px;">
                            <a
                              href="${safeReplyUrl}"
                              style="display:inline-block;padding:15px 24px;border:1px solid #241d18;border-radius:8px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;"
                            >
                              Reply to customer &rarr;
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p style="margin:20px 0 0;color:#766e66;font-size:12px;line-height:1.6;">
                  Sent from the Nolters FAQ assistant.
                </p>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

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
        text,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!emailResponse.ok) {
      console.error("FAQ email delivery failed", emailResponse.status);

      return response.status(502).json({
        ok: false,
        error: "delivery_failed",
      });
    }

    return response.status(200).json({ ok: true });
  } catch {
    console.error("FAQ contact request failed");

    return response.status(500).json({
      ok: false,
      error: "request_failed",
    });
  }
}