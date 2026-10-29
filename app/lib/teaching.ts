// API client for the .NET backend.
//
// Requests go through the same-origin Next.js proxy at /api/api-proxy, which
// forwards to the backend. This keeps the frontend working no matter whether
// the backend is started with the `http` or the `https` launch profile —
// pointing the browser straight at a TLS-only port would fail with
// "Failed to fetch".
//
// The session itself lives in httpOnly cookies set by /api/session, so the
// browser sends the credentials back on every request. That means a page
// reload (or a browser restart) keeps the user signed in without any
// client-side token handling.
const API_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
    "/api/api-proxy";

const LAST_USER_KEY = "teaching_last_user";

export type User = { id: string; name: string; username: string; email: string };
export type ClassItem = {
  id: string;
  name: string;
  description: string;
  fee: number;
  createdAt: string;
  studentCount: number;
};
export type Student = {
  id: string;
  classId: string;
  name: string;
  phone: string;
  note: string;
};
export type Payment = { studentId: string; month: string; paid: boolean };

// The last username is kept so the login form can pre-fill it. This is only
// a convenience — it is not a credential and grants no access.
export function setLastUsername(username: string) {
  if (typeof window === "undefined") return;
  if (username) localStorage.setItem(LAST_USER_KEY, username);
  else localStorage.removeItem(LAST_USER_KEY);
  notifyLastUsernameChanged();
}

// The stored username is read through useSyncExternalStore so the server and
// the first client render agree (both start empty) and the real value is
// filled in right after hydration.
const LAST_USER_EVENT = "teaching-last-user-changed";

let cachedUsername: string | null = null;
let cachedUsernameValue = "";

export function getLastUsernameSnapshot(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem(LAST_USER_KEY);
  if (raw === cachedUsername) return cachedUsernameValue;
  cachedUsername = raw;
  cachedUsernameValue = raw ?? "";
  return cachedUsernameValue;
}

export function getServerLastUsernameSnapshot(): string {
  return "";
}

export function subscribeLastUsername(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener(LAST_USER_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(LAST_USER_EVENT, cb);
  };
}

function notifyLastUsernameChanged() {
  if (typeof window === "undefined") return;
  cachedUsername = null;
  window.dispatchEvent(new Event(LAST_USER_EVENT));
}

// ---------------- session store ----------------
// Lets React read the signed-in user without setState-in-effect (and without
// a hydration flash): subscribers are notified whenever the session changes.
const SESSION_EVENT = "teaching-session-changed";

export function subscribeSession(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener(SESSION_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(SESSION_EVENT, cb);
  };
}

// The current user is held in memory only. It is re-read from the server
// (via the httpOnly cookie) whenever the page loads.
let currentUser: User | null = null;

export function getSessionSnapshot(): User | null {
  if (typeof window === "undefined") return null;
  return currentUser;
}

// Stable server snapshot — must be identical on every call.
export function getServerSessionSnapshot(): User | null {
  return null;
}

export function notifySessionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function setSessionUser(user: User | null) {
  currentUser = user;
  notifySessionChanged();
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  // `credentials: "include"` makes the browser send the session cookies.
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      typeof data === "string"
        ? data
        : (data as { title?: string; message?: string })?.message ??
          (data as { title?: string })?.title ??
          `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

type AuthResponse = {
  id: string;
  name: string;
  username: string;
  email: string;
  token: string;
  rememberToken?: string | null;
  rememberExpiresDays?: number;
};

export async function apiRegister(
  name: string,
  username: string,
  email: string,
  password: string,
  rememberMe: boolean
) {
  // The proxy stores the tokens in httpOnly cookies on its way back, so the
  // browser sends them automatically from now on.
  const r = await req<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, username, email, password, rememberMe }),
  });
  setLastUsername(username);
  setSessionUser({ id: r.id, name: r.name, username: r.username, email: r.email });
  return r;
}

export async function apiLogin(
  username: string,
  password: string,
  rememberMe: boolean
) {
  const r = await req<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, rememberMe }),
  });
  setLastUsername(username);
  setSessionUser({ id: r.id, name: r.name, username: r.username, email: r.email });
  return r;
}

// Restores the session from the httpOnly cookie. The proxy exchanges the
// remember cookie for a fresh access token when needed.
export async function apiRestoreSession(): Promise<User | null> {
  try {
    const u = await req<User>("/api/auth/me");
    setSessionUser(u);
    return u;
  } catch {
    setSessionUser(null);
    return null;
  }
}

// Clears the cookies and the in-memory session.
export async function apiLogout() {
  try {
    await fetch("/api/session", { method: "DELETE", credentials: "include" });
  } catch {
    // The cookies are cleared by the server; a network failure here must not
    // keep the user stuck in a signed-in state.
  }
  setSessionUser(null);
}

export const apiClasses = {
  list: () => req<ClassItem[]>("/api/classes"),
  create: (name: string, description: string, fee: number) =>
    req<ClassItem>("/api/classes", {
      method: "POST",
      body: JSON.stringify({ name, description, fee }),
    }),
  update: (id: string, name: string, description: string, fee: number) =>
    req<ClassItem>(`/api/classes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, description, fee }),
    }),
  remove: (id: string) =>
    req<void>(`/api/classes/${id}`, { method: "DELETE" }),
};

export const apiStudents = {
  list: (classId: string) =>
    req<Student[]>(`/api/classes/${classId}/students`),
  create: (classId: string, name: string, phone: string, note: string) =>
    req<Student>(`/api/classes/${classId}/students`, {
      method: "POST",
      body: JSON.stringify({ name, phone, note }),
    }),
  // Creates many students in one request.
  createBulk: (classId: string, names: string[], phone: string, note: string) =>
    req<{ created: Student[]; skipped: number }>(
      `/api/classes/${classId}/students/bulk`,
      {
        method: "POST",
        body: JSON.stringify({ names, phone, note }),
      }
    ),
  update: (id: string, name: string, phone: string, note: string) =>
    req<Student>(`/api/students/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, phone, note }),
    }),
  remove: (id: string) =>
    req<void>(`/api/students/${id}`, { method: "DELETE" }),
};

export const apiPayments = {
  list: (classId: string, month: string) =>
    req<Payment[]>(
      `/api/payments?classId=${encodeURIComponent(classId)}&month=${encodeURIComponent(month)}`
    ),
  listYear: (classId: string, year: string) =>
    req<Payment[]>(
      `/api/payments/year?classId=${encodeURIComponent(classId)}&year=${encodeURIComponent(year)}`
    ),
  set: (studentId: string, month: string, paid: boolean) =>
    req<Payment>("/api/payments", {
      method: "PUT",
      body: JSON.stringify({ studentId, month, paid }),
    }),
};

// Splits a list of student names typed into one field.
//
// The primary separator is a semicolon (";"), as requested. Newlines and
// commas are accepted too, because pasting a list from a spreadsheet or a
// chat message usually brings those along. Blank entries are dropped and
// surrounding whitespace is trimmed.
export function splitStudentNames(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[;\n\r,]+/)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonth(m: string): string {
  const [y, mo] = m.split("-");
  const d = new Date(Number(y), Number(mo) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ---------------- AI photo scan ----------------
// Sends a photo of a printed tuition table to the server, which reads it
// with the free Gemini vision API and returns structured rows.
export type ScanPaymentRow = {
  name: string;
  paidMonths: number[];
  confidence: number;
  note: string;
};

export type ScanPaymentsResult = {
  year: string;
  months: { index: number; label: string }[];
  rows: ScanPaymentRow[];
};

export async function apiScanPayments(
  image: File,
  year: string,
  existingNames: string[]
): Promise<ScanPaymentsResult> {
  const form = new FormData();
  form.append("image", image);
  form.append("year", year);
  form.append("existingNames", JSON.stringify(existingNames));
  const res = await fetch("/api/ai/scan-payments", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      typeof data === "string"
        ? data
        : (data as { message?: string; title?: string })?.message ??
          (data as { title?: string })?.title ??
          `Scan failed (${res.status})`;
    throw new Error(msg);
  }
  return data as ScanPaymentsResult;
}

// Matches a scanned name against existing students, ignoring case,
// extra spaces and Vietnamese diacritics, so "Nguyễn Văn A",
// "nguyen van a" and "Nguyen Van A" all match.
export function normalizeName(n: string): string {
  return n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
