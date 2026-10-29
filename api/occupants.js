import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const COOKIE_NAME = "kibelki_session";
const COOKIE_MAX_AGE = 60 * 60 * 24;
const PRESENCE_TTL_MINUTES = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let tableReady;

function ensureTable(sql) {
  if (!tableReady) {
    tableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS bathroom_presence (
          session_id UUID PRIMARY KEY,
          entry_id UUID NOT NULL UNIQUE,
          floor SMALLINT NOT NULL CHECK (floor BETWEEN 0 AND 2),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS bathroom_presence_created_at_idx
        ON bathroom_presence (created_at)
      `;
    })().catch(error => {
      tableReady = undefined;
      throw error;
    });
  }
  return tableReady;
}

function signSession(id, secret) {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

function sessionFromRequest(req, secret) {
  const cookies = (req.headers.cookie || "").split(";");
  const value = cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(COOKIE_NAME + "="))?.slice(COOKIE_NAME.length + 1);
  if (!value) return null;

  const [id, signature, extra] = value.split(".");
  if (extra !== undefined || !UUID_PATTERN.test(id || "") || !signature) return null;
  const expected = Buffer.from(signSession(id, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  return id;
}

function setSessionCookie(res, id, secret) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${id}.${signSession(id, secret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${secure}`,
  );
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

async function readJsonBody(req) {
  if (req.body !== undefined) {
    return req.body;
  }

  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.includes("application/json") && !contentType.includes("text/plain")) {
    return {};
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return { __invalid_json__: raw };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return sendError(res, 405, "Ta metoda nie jest obsługiwana.");
  }
  if (req.method !== "GET" && !sameOrigin(req)) {
    return sendError(res, 403, "Żądanie spoza tej strony zostało odrzucone.");
  }

  const { DATABASE_URL, SESSION_SECRET } = process.env;
  if (!DATABASE_URL || !SESSION_SECRET || Buffer.byteLength(SESSION_SECRET) < 32) {
    return sendError(res, 503, "Baza nie jest skonfigurowana. Ustaw DATABASE_URL i SESSION_SECRET.");
  }

  const existingSessionId = sessionFromRequest(req, SESSION_SECRET);
  const sessionId = existingSessionId || randomUUID();
  if (!existingSessionId) setSessionCookie(res, sessionId, SESSION_SECRET);

  try {
    const sql = neon(DATABASE_URL);
    await ensureTable(sql);
    await sql`
      DELETE FROM bathroom_presence
      WHERE created_at <= now() - (${PRESENCE_TTL_MINUTES} * INTERVAL '1 minute')
    `;

    if (req.method === "GET") {
      const entries = await sql`
        SELECT entry_id AS id, floor, session_id = ${sessionId}::uuid AS mine
        FROM bathroom_presence
        ORDER BY created_at ASC
      `;
      return res.status(200).json({ entries });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const floor = body?.floor;
      if (!Number.isInteger(floor) || floor < 0 || floor > 2) {
        return sendError(res, 400, "Piętro musi być liczbą od 0 do 2.");
      }

      await sql`
        INSERT INTO bathroom_presence (session_id, entry_id, floor, created_at)
        VALUES (${sessionId}::uuid, ${randomUUID()}::uuid, ${floor}, now())
        ON CONFLICT (session_id) DO UPDATE
        SET entry_id = EXCLUDED.entry_id, floor = EXCLUDED.floor, created_at = now()
      `;
      return res.status(204).end();
    }

    await sql`DELETE FROM bathroom_presence WHERE session_id = ${sessionId}::uuid`;
    return res.status(204).end();
  } catch (error) {
    console.error("Obsługa obecności nie powiodła się:", error);
    return sendError(res, 500, "Nie udało się zapisać danych. Spróbuj ponownie.");
  }
}
