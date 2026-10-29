import { NextRequest } from "next/server";

// POST /api/ai/scan-payments
//
// Accepts a photo of a printed tuition table (rows = students, month columns
// contain a student signature when that month is paid) and returns structured
// JSON using the free Google Gemini API (gemini-2.0-flash).
//
// Free tier covers this use case easily (about 5 scans/day): no credit card,
// ~1,500 requests/day free at the time of writing.
//
// Setup: copy .env.example -> .env.local and set GEMINI_API_KEY from
// https://aistudio.google.com/apikey
//
// Request: multipart/form-data with:
//   - image: the photo file (jpeg/png/webp, max 10 MB)
//   - year:  e.g. "2026" (the year the table belongs to)
//   - existingNames (optional): JSON array of known student names in the class,
//     so the model returns names with matching spelling.
//
// Response 200:
//   { year, months: [{index, label}], rows: [{name, paidMonths, confidence, note}] }
//   paidMonths are 1-based month numbers (1 = January).
//
// Response 503: GEMINI_API_KEY is not configured.
// Response 429: Gemini quota exhausted (free tier) — try again later.

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// Simple per-instance rate limit so a shared deployment cannot burn the free
// quota in one sitting: 60 scans per hour across all callers.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 60;
let windowStart = 0;
let windowCount = 0;

function rateLimited(): boolean {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount > MAX_PER_WINDOW;
}

type ScanRow = {
  name: string;
  paidMonths: number[];
  confidence: number;
  note: string;
};

function sanitizeRows(raw: unknown): ScanRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ScanRow[] = [];
  for (const r of raw.slice(0, 100)) {
    if (typeof r !== "object" || r === null) continue;
    const rec = r as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const paidRaw = Array.isArray(rec.paidMonths) ? rec.paidMonths : [];
    const paidSet = new Set<number>();
    for (const m of paidRaw) {
      const n = typeof m === "number" ? Math.round(m) : parseInt(String(m), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 12) paidSet.add(n);
    }
    let confidence = Number(rec.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.min(1, Math.max(0, confidence));
    const note = typeof rec.note === "string" ? rec.note.slice(0, 200) : "";
    out.push({ name, paidMonths: [...paidSet].sort((a, b) => a - b), confidence, note });
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (rateLimited()) {
    return Response.json(
      { title: "Too many scans", message: "Too many scans — please try again later." },
      { status: 429 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      {
        title: "AI not configured",
        message:
          "GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey and add it to .env.local as GEMINI_API_KEY=...",
      },
      { status: 503 }
    );
  }

  let file: File | null = null;
  let year = "";
  let existingNames: string[] = [];
  try {
    const form = await req.formData();
    const f = form.get("image");
    if (f instanceof File) file = f;
    // Some clients send the field as "photo" — accept that too.
    const alt = form.get("photo");
    if (!file && alt instanceof File) file = alt;
    year = String(form.get("year") ?? "").trim();
    const namesRaw = form.get("existingNames");
    if (typeof namesRaw === "string" && namesRaw) {
      try {
        const parsed: unknown = JSON.parse(namesRaw);
        if (Array.isArray(parsed)) {
          existingNames = parsed
            .filter((n): n is string => typeof n === "string")
            .map((n) => n.trim())
            .filter(Boolean)
            .slice(0, 200);
        }
      } catch {
        // Ignore a malformed names list — matching still works without it.
      }
    }
  } catch {
    return Response.json(
      { title: "Bad upload", message: "Could not read the uploaded image." },
      { status: 400 }
    );
  }

  if (!file || file.size === 0) {
    return Response.json(
      { title: "No image", message: "Please attach a photo of the payment table." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { title: "Image too large", message: "Please use an image under 10 MB." },
      { status: 400 }
    );
  }
  const mime = (file.type || "").toLowerCase();
  if (mime && ![...ALLOWED_MIME].some((m) => mime.startsWith(m.split("/")[0]) && ALLOWED_MIME.has(mime))) {
    // Keep accepting when the browser omits the type, reject only clear mismatches.
    if (mime && !ALLOWED_MIME.has(mime)) {
      return Response.json(
        { title: "Unsupported image", message: "Please upload a JPG, PNG or WebP photo." },
        { status: 400 }
      );
    }
  }
  if (!/^\d{4}$/.test(year)) {
    const d = new Date();
    year = String(d.getFullYear());
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");
  const mimeType = ALLOWED_MIME.has(mime) ? mime : "image/jpeg";

  const knownList =
    existingNames.length > 0
      ? `\nKnown students in this class (match spelling exactly when the handwriting/print matches one of them, ignoring case): ${JSON.stringify(existingNames)}. If a row clearly matches a known student, return the known spelling. Otherwise return the name as read and the app will create a new student.`
      : "";

  const prompt = `You read a printed tuition-fee table photo. Rows are students. The first column is the student name. The following columns are months (Jan-Dec, or Th1-Th12 / Tháng 1-12, or 1-12). A month cell counts as PAID when it contains a student signature, handwriting, a tick (✓), an "x", a stamp, or any ink mark. Empty/blank cells are UNPAID. Header decorations, grid lines and logos are not marks.\nThis table belongs to year ${year}. Return paid months as 1-based month numbers.\n${knownList}\nBe careful with Vietnamese names and diacritics (e.g. Nguyễn, Trần, Thị). Skip non-student rows (headers, totals, examples). If unsure about a cell, leave it unpaid.`;

  const body = {
    systemInstruction: {
      parts: [
        {
          text: "You extract structured data from photos of tuition payment tables. Always respond with valid JSON matching the requested schema. Never invent students.",
        },
      ],
    },
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseSchema: {
        type: "OBJECT",
        properties: {
          months: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                index: { type: "INTEGER" },
                label: { type: "STRING" },
              },
              required: ["index"],
            },
          },
          rows: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                paidMonths: { type: "ARRAY", items: { type: "INTEGER" } },
                confidence: { type: "NUMBER" },
                note: { type: "STRING" },
              },
              required: ["name", "paidMonths"],
            },
          },
        },
        required: ["rows"],
      },
    },
  };

  let geminiRes: Response;
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  } catch (e) {
    return Response.json(
      {
        title: "AI unreachable",
        message: e instanceof Error ? e.message : "Could not reach the AI service.",
      },
      { status: 502 }
    );
  }

  if (geminiRes.status === 429) {
    return Response.json(
      {
        title: "Free quota exhausted",
        message: "The free AI quota is exhausted for now — please try again later.",
      },
      { status: 429 }
    );
  }
  if (!geminiRes.ok) {
    let detail = `AI request failed (${geminiRes.status})`;
    try {
      const err = (await geminiRes.json()) as { error?: { message?: string } };
      if (err?.error?.message) detail = err.error.message.slice(0, 500);
    } catch {
      // Keep the generic message.
    }
    return Response.json({ title: "AI error", message: detail }, { status: 502 });
  }

  try {
    const data = (await geminiRes.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new Error("empty response");
    const parsed: unknown = JSON.parse(text);
    const obj = parsed as { months?: unknown; rows?: unknown };
    const rows = sanitizeRows(obj.rows);
    const monthsRaw = Array.isArray(obj.months) ? obj.months : [];
    const months: { index: number; label: string }[] = [];
    for (const m of monthsRaw.slice(0, 12)) {
      if (typeof m !== "object" || m === null) continue;
      const rec = m as Record<string, unknown>;
      const idx = Number(rec.index);
      if (!Number.isFinite(idx) || idx < 1 || idx > 12) continue;
      months.push({
        index: Math.round(idx),
        label: typeof rec.label === "string" ? rec.label.slice(0, 20) : "",
      });
    }
    return Response.json({ year, months, rows });
  } catch {
    return Response.json(
      { title: "AI parse error", message: "The AI reply was not valid — please try the photo again." },
      { status: 502 }
    );
  }
}
