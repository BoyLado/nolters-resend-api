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
        text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
        html: `
          <div style="background:#f5f5f5;padding:24px;font-family:Arial,sans-serif">
            <div style="max-width:600px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;color:#222">
              <h1 style="margin:0 0 24px;font-size:24px">New website inquiry</h1>
              <p><strong>Name:</strong> ${escapeHtml(name)}</p>
              <p><strong>Email:</strong> ${escapeHtml(email)}</p>
              <hr style="margin:24px 0;border:0;border-top:1px solid #ddd">
              <div style="white-space:pre-wrap;overflow-wrap:anywhere"><b>Question asked in FAQ assistant:</b> ${escapeHtml(message)}</div>
            </div>
          </div>
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