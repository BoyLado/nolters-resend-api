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

    if (
      data.website !== undefined &&
      typeof data.website !== "string"
    ) {
      return response.status(400).json({
        ok: false,
        error: "invalid_fields",
      });
    }

    if (typeof data.website === "string" && data.website.trim()) {
      return response.status(200).json({ ok: true });
    }

    const name = typeof data.name === "string" ? data.name.trim() : "";
    const email = typeof data.email === "string" ? data.email.trim() : "";
    const message = typeof data.message === "string" ? data.message.trim() : "";

    const productFields = {
      product: 300,
      option: 300,
      sku: 200,
      productUrl: 2048,
      productImage: 2048,
    };

    for (const [field, maxLength] of Object.entries(productFields)) {
      const value = data[field];

      if (
        value !== undefined &&
        (typeof value !== "string" || value.length > maxLength)
      ) {
        return response.status(400).json({
          ok: false,
          error: "invalid_fields",
        });
      }
    }

    const product = typeof data.product === "string" ? data.product.trim() : "";
    const option = typeof data.option === "string" ? data.option.trim() : "";
    const sku = typeof data.sku === "string" ? data.sku.trim() : "";
    const productUrl = typeof data.productUrl === "string" ? data.productUrl.trim() : "";

    const productImage = typeof data.productImage === "string" ? data.productImage.trim() : "";

    let safeProductImage = "";

    try {
      const url = new URL(productImage);

      const allowedImageHosts = new Set([
        "cdn.shopify.com",
        ...allowedOrigins.map((value) => new URL(value).hostname),
      ]);

      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        allowedImageHosts.has(url.hostname)
      ) {
        safeProductImage = url.href;
      }
    } catch {}

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

    let safeProductUrl = "";

    try {
      const url = new URL(productUrl);

      if (url.protocol === "https:") {
        safeProductUrl = url.href;
      }
    } catch {
      // Leave invalid or empty URLs unlinked.
    }

    const replyUrl = `mailto:${email}?subject=${encodeURIComponent(
      product ? `Re: Inquiry about ${product}` : "Re: Your website inquiry",
    )}`;

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
        subject: "New website inquiry",
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          `Message: ${message}`,
          `Product: ${product || "—"}`,
          `Option: ${option || "—"}`,
          `SKU: ${sku || "—"}`,
          `Product URL: ${productUrl || "—"}`,
        ].join("\n"),
        html: `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>New website inquiry</title>
            </head>

            <body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#242424;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f2ee;">
                <tr>
                  <td align="center" style="padding:32px 12px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e7e2d9;border-radius:16px;">

                      <tr>
                        <td style="padding:32px 24px;background-color:#242424;border-radius:16px 16px 0 0;">
                          <p style="margin:0 0 12px;color:#dfc58e;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">
                            Website contact form
                          </p>
                          <h1 style="margin:0;color:#ffffff;font-size:28px;line-height:1.3;">
                            New inquiry
                          </h1>
                          <p style="margin:12px 0 0;color:#dedede;font-size:14px;line-height:1.6;">
                            A customer reached out through your Shopify store.
                          </p>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:28px 24px;">
                          <h2 style="margin:0 0 16px;color:#777064;font-size:12px;letter-spacing:1px;text-transform:uppercase;">
                            Customer details
                          </h2>

                          <p style="margin:0 0 12px;font-size:15px;line-height:1.7;overflow-wrap:anywhere;">
                            <strong>Name:</strong> ${escapeHtml(name)}
                          </p>
                          <p style="margin:0;font-size:15px;line-height:1.7;overflow-wrap:anywhere;">
                            <strong>Email:</strong>
                            <a href="${escapeHtml(replyUrl)}" style="color:#675020;text-decoration:underline;">
                              ${escapeHtml(email)}
                            </a>
                          </p>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:0 24px 28px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td style="padding:20px;background-color:#f8f6f2;border-left:3px solid #a18449;border-radius:4px;">
                                <p style="margin:0;font-size:15px;line-height:1.8;overflow-wrap:anywhere;word-break:break-word;">
                                  <strong>Message:</strong><br>
                                  ${escapeHtml(message).replace(/\r\n|\r|\n/g, "<br>")}
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:24px;border-top:1px solid #eeeae3;">
                          <h2 style="margin:0 0 16px;color:#777064;font-size:12px;letter-spacing:1px;text-transform:uppercase;">
                            Product details
                          </h2>

                          <p style="margin:0 0 12px;font-size:15px;line-height:1.7;overflow-wrap:anywhere;">
                            <strong>Product:</strong> ${escapeHtml(product || "—")}
                          </p>
                          <p style="margin:0 0 12px;font-size:15px;line-height:1.7;overflow-wrap:anywhere;">
                            <strong>Option:</strong> ${escapeHtml(option || "—")}
                          </p>
                          <p style="margin:0 0 12px;font-size:15px;line-height:1.7;overflow-wrap:anywhere;">
                            <strong>SKU:</strong> ${escapeHtml(sku || "—")}
                          </p>
                          <p style="margin:0;font-size:14px;line-height:1.7;overflow-wrap:anywhere;word-break:break-word;">
                            <strong>Product URL:</strong><br>
                            ${
                              safeProductUrl
                                ? `<a href="${escapeHtml(safeProductUrl)}" style="color:#675020;text-decoration:underline;">${escapeHtml(safeProductUrl)}</a>`
                                : escapeHtml(productUrl || "—")
                            }
                          </p>

                          ${
                            safeProductImage
                              ? `
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                  <tr>
                                    <td align="center" style="padding:0 0 20px;">
                                      <img
                                        src="${escapeHtml(safeProductImage)}"
                                        alt="${escapeHtml(product)}"
                                        width="280"
                                        style="display:block;width:100%;max-width:280px;height:auto;border:0;border-radius:8px;"
                                      >
                                    </td>
                                  </tr>
                                </table>
                              `
                              : ""
                          }

                        </td>
                      </tr>

                      <tr>
                        <td style="padding:4px 24px 32px;">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td align="center" bgcolor="#242424" style="border-radius:8px;">
                                <a href="${escapeHtml(replyUrl)}" style="display:inline-block;padding:15px 24px;border:1px solid #242424;border-radius:8px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;">
                                  Reply to customer &rarr;
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                    </table>

                    <p style="margin:20px 0 0;color:#767676;font-size:12px;line-height:1.6;">
                      Sent from your store’s inquiry form.
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