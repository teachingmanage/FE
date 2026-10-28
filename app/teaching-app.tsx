"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ClassItem,
  Payment,
  Student,
  apiClasses,
  apiLogin,
  apiLogout,
  apiPayments,
  apiRegister,
  apiRestoreSession,
  apiStudents,
  getLastUsernameSnapshot,
  getServerLastUsernameSnapshot,
  getServerSessionSnapshot,
  getSessionSnapshot,
  splitStudentNames,
  subscribeLastUsername,
  subscribeSession,
} from "./lib/teaching";
import {
  Lang,
  MONTH_LABELS,
  getLangSnapshot,
  getServerLangSnapshot,
  setLang,
  subscribeLang,
  translate,
} from "./lib/i18n";
import { InstallButton } from "./lib/install-button";

// ---------- reusable styles (explicit light theme, high contrast) ----------
const card = "rounded-2xl border border-slate-200 bg-white shadow-sm";
const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const btnPrimary =
  "rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:from-indigo-500 hover:to-violet-500 active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none";
const btnGhost =
  "rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[.98]";
const btnDanger =
  "rounded-xl border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 active:scale-[.98]";
const labelCls = "mb-1 block text-xs font-semibold tracking-wide text-slate-600 uppercase";

// Reads "today" on the client only, so `new Date()` never runs during prerender.
// The server snapshot is empty, which is what keeps the build prerender-safe.
const getTodayMonth = () => {
  const d = new Date();
  // Zero-padded so it matches the "YYYY-MM" keys used by the `months` array.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const noopSubscribe = () => () => {};

// Grid sizing: how many month columns fit on screen.
// The table uses `table-fixed` + a `colgroup`, so the name and actions columns
// have an exact width and the month columns share whatever is left over.
// The numbers below must match what is actually rendered, otherwise the table
// overflows its container and the user has to scroll sideways.
//
// Every value is a continuous function of the container width, so the number of
// visible months only ever grows as the device gets wider — it never drops.
const GRID_NAME_COL_MIN = 76;
const GRID_NAME_COL_MAX = 190;
const GRID_NAME_COL_RATIO = 0.24;
// Icon-only action buttons need ~76px including the cell padding, the full
// text buttons ("Edit" / "Delete") need ~140px.
const GRID_ACTIONS_COL_MIN = 76;
const GRID_ACTIONS_COL_MAX = 160;
const GRID_ACTIONS_COL_RATIO = 0.2;
const GRID_ACTIONS_TEXT_MIN = 140;
// A month column must be wide enough for its header label ("Jan") and for the
// toggle button (which is 4px of border + the check glyph).
const GRID_CELL_MIN = 28;
// On a phone the grid shows a fixed, small set of months. The cells are then
// large enough to be comfortable tap targets.
const GRID_PHONE_MAX_WIDTH = 480;
const GRID_PHONE_COLS = 3;
// On a phone the name column keeps at least this much room, and the month
// cells are never wider than this.
const GRID_PHONE_NAME_MIN = 120;
const GRID_PHONE_CELL_MAX = 64;
// On a phone the action buttons are icon-only squares with a fixed size, so
// the actions column can be sized to exactly fit them. Without a fixed size
// the buttons size themselves to their glyph and overflow the column — and
// because the cell is right-aligned, the overflow spills left and covers the
// last month cell, hiding its tick.
const GRID_PHONE_ACTION_BTN = 30;
// The gap between the two action buttons (Tailwind's `gap-1`).
const GRID_PHONE_ACTION_GAP = 4;
// The actions cell's own horizontal padding (px-2, so 8px per side) plus the
// table border.
const GRID_PHONE_ACTIONS_PAD = 18;
// Horizontal padding of a month cell (px-1 on each side of the button).
const GRID_CELL_PAD = 4;
// Above the phone range the cell width shrinks towards the minimum, so the
// month count grows gradually from 3 up to 12 instead of jumping straight to
// a dozen cramped columns on a small tablet.
const GRID_CELL_RAMP_END = 700;
const GRID_CELL_RAMP_MAX = 88;

function clamp(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function gridLayout(width: number) {
  // Before the first measurement the width is 0. Fall back to the compact
  // layout so the very first paint already looks like a phone layout instead
  // of briefly flashing the desktop one.
  const phone = width > 0 && width <= GRID_PHONE_MAX_WIDTH;

  if (phone) {
    // On a phone only three months are shown. The name column keeps a usable
    // width and the three month cells become large, square tap targets.
    //
    // The actions column is sized to exactly fit the two icon buttons, so the
    // buttons can never overflow into the last month cell and hide its tick.
    const actions = GRID_PHONE_ACTION_BTN * 2 + GRID_PHONE_ACTION_GAP + GRID_PHONE_ACTIONS_PAD;
    const available = Math.max(0, width - actions);
    // The month cells are capped so the leftover width goes to the name
    // column instead of making the cells enormous. On very narrow screens the
    // name column has to give way so the cells still fit.
    const nameMin = Math.min(GRID_PHONE_NAME_MIN, Math.max(0, available - GRID_PHONE_COLS * GRID_CELL_MIN));
    const cellWidth = clamp(
      (available - nameMin) / GRID_PHONE_COLS,
      GRID_CELL_MIN,
      GRID_PHONE_CELL_MAX
    );
    const name = Math.max(nameMin, available - cellWidth * GRID_PHONE_COLS);
    // The month cell has GRID_CELL_PAD of horizontal padding on each side, so
    // the square button inside it is that much narrower than the column.
    const buttonWidth = Math.max(24, cellWidth - GRID_CELL_PAD * 2);
    return {
      nameCol: name,
      actionsCol: actions,
      cellWidth,
      buttonWidth,
      actionButtonWidth: GRID_PHONE_ACTION_BTN,
      cellCount: GRID_PHONE_COLS,
      compact: true,
      phone: true,
    };
  }

  const nameCol = clamp(width * GRID_NAME_COL_RATIO, GRID_NAME_COL_MIN, GRID_NAME_COL_MAX);
  const actionsCol = clamp(
    width * GRID_ACTIONS_COL_RATIO,
    GRID_ACTIONS_COL_MIN,
    GRID_ACTIONS_COL_MAX
  );
  // Icon-only buttons are used whenever the actions column is too narrow for
  // the text ones. Because the column width grows continuously, this switch
  // happens at exactly one width and never causes a jump in the month count.
  const compact = actionsCol < GRID_ACTIONS_TEXT_MIN;
  // Never let the fixed columns eat the whole width — the table must always
  // leave room for at least one month column.
  const maxFixed = Math.max(0, width - GRID_CELL_MIN);
  const scale = nameCol + actionsCol > maxFixed ? maxFixed / (nameCol + actionsCol) : 1;
  const fixedName = Math.round(nameCol * scale);
  const fixedActions = Math.round(actionsCol * scale);
  const usable = Math.max(0, width - fixedName - fixedActions);
  // The minimum cell width shrinks with the viewport so the month count
  // increases gradually instead of jumping from 3 to a dozen cramped columns.
  const ramp = clamp(
    GRID_CELL_RAMP_MAX -
      ((width - GRID_PHONE_MAX_WIDTH) / (GRID_CELL_RAMP_END - GRID_PHONE_MAX_WIDTH)) *
        (GRID_CELL_RAMP_MAX - GRID_CELL_MIN),
    GRID_CELL_MIN,
    GRID_CELL_RAMP_MAX
  );
  const count = Math.max(1, Math.min(12, Math.floor(usable / ramp)));
  return {
    nameCol: fixedName,
    actionsCol: fixedActions,
    cellWidth: usable / count,
    buttonWidth: usable / count - GRID_CELL_PAD * 2,
    // Off the phone the action buttons size themselves to their content and
    // the column is wide enough for them.
    actionButtonWidth: undefined,
    cellCount: count,
    compact,
    phone: false,
  };
}

// useLayoutEffect warns during SSR; useEffect there instead.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white align-middle" />
  );
}

// Tracks the width of an element so the grid can fit 1-12 month columns.
//
// A callback ref is used instead of an object ref because the element is not
// mounted on the first render (the grid only exists once a class is selected).
// An effect with an empty dependency list would run while `ref.current` is
// still null and would never attach the observer, leaving the width at 0.
function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  // Detach the observer when the component unmounts.
  useIsomorphicLayoutEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  return [ref, width] as const;
}

// Language switcher (EN / VI).
function LangToggle({
  lang,
  onChange,
  variant = "light",
}: {
  lang: Lang;
  onChange: (l: Lang) => void;
  variant?: "light" | "dark";
}) {
  const options: { value: Lang; label: string }[] = [
    { value: "en", label: "EN" },
    { value: "vi", label: "VI" },
  ];
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg p-0.5 text-xs font-bold ${
        variant === "dark" ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
      }`}
      role="group"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={lang === o.value}
          className={`rounded-md px-2 py-1 transition ${
            lang === o.value
              ? "bg-white text-indigo-700 shadow"
              : variant === "dark"
                ? "text-white/80 hover:text-white"
                : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function TeachingApp({ apiAddress }: { apiAddress: string }) {
  const user = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot
  );
  const lang = useSyncExternalStore(subscribeLang, getLangSnapshot, getServerLangSnapshot);
  const t = useCallback(
    (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
      translate(lang, key, { api: apiAddress, ...vars }),
    [lang, apiAddress]
  );
  const monthLabels = MONTH_LABELS[lang];

  // Keep the document language in sync so the browser picks the right
  // glyph shaping / hyphenation / screen-reader voice for the text.
  useEffect(() => {
    document.documentElement.lang = lang === "vi" ? "vi" : "en";
  }, [lang]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // auth form
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Keeps the user signed in for a year via a long-lived httpOnly cookie.
  const [rememberMe, setRememberMe] = useState(true);
  // The last username that was used, so the user only has to type the
  // password next time.
  const lastUsername = useSyncExternalStore(
    subscribeLastUsername,
    getLastUsernameSnapshot,
    getServerLastUsernameSnapshot
  );
  // `null` means "the user has not typed anything yet", so the field can
  // follow the stored username until they start typing.
  const [typedUsername, setTypedUsername] = useState<string | null>(null);
  const username = typedUsername ?? (mode === "login" ? lastUsername : "");

  // Restore the session from the httpOnly cookie when the app mounts. Without
  // this the user would have to log in again on every page reload.
  const [sessionResolved, setSessionResolved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    apiRestoreSession().finally(() => {
      if (!cancelled) setSessionResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // classes
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classForm, setClassForm] = useState({ name: "", description: "", fee: "" });
  const [editingClassId, setEditingClassId] = useState<string | null>(null);

  // students + payments (whole-year grid)
  const [students, setStudents] = useState<Student[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [studentForm, setStudentForm] = useState({ name: "", phone: "", note: "" });
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  // `year` is derived from the client-only "today" snapshot unless the user picks one.
  const [yearOverride, setYearOverride] = useState<string | null>(null);
  const todayMonth = useSyncExternalStore(noopSubscribe, getTodayMonth, () => "");
  const year = yearOverride ?? todayMonth.slice(0, 4);

  const yearOptions = useMemo(() => {
    if (!todayMonth) return [];
    const y = Number(todayMonth.slice(0, 4));
    return Array.from({ length: 5 }, (_, i) => String(y - 2 + i));
  }, [todayMonth]);

  const months = useMemo(
    () =>
      year
        ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
        : [],
    [year]
  );

  // How many month columns fit on this device (1-12).
  // The grid is laid out with `table-fixed` + a colgroup, so the month columns
  // are sized to exactly fill the container. The table therefore never needs
  // horizontal scrolling — it just shows fewer months on smaller screens.
  const [gridRef, gridWidth] = useElementWidth<HTMLDivElement>();
  const measured = gridWidth > 0;
  const { nameCol, actionsCol, cellWidth, buttonWidth, actionButtonWidth, cellCount, compact, phone } = useMemo(
    () => gridLayout(gridWidth),
    [gridWidth]
  );
  const visibleCols = cellCount;
  // Width of a single month column, used to decide whether the header can
  // show the month name ("Jan", "Th10") or has to fall back to the number.
  const monthCellWidth = cellWidth;
  const showMonthNames = useMemo(() => {
    if (!measured) return true;
    const longest = Math.max(...monthLabels.map((l) => l.length));
    // ~6.5px per character at 11px bold uppercase, plus the cell's padding.
    return monthCellWidth >= longest * 6.5 + 8;
  }, [measured, monthCellWidth, monthLabels]);
  // The name and actions headers are truncated on narrow devices, so short
  // variants are used instead ("Học sinh" -> "Tên").
  const showShortHeaders = useMemo(() => {
    if (!measured) return false;
    return nameCol < 96;
  }, [measured, nameCol]);

  // When not all 12 months fit, the grid pages through the year.
  // `null` means "no manual choice yet" — the window then follows the current
  // month, so the user always lands on a relevant part of the year.
  const [monthStartOverride, setMonthStartOverride] = useState<number | null>(null);
  const maxOffset = Math.max(0, 12 - visibleCols);
  // Index of the month the window should centre on (today's month for the
  // current year, January otherwise).
  const focusMonth = useMemo(() => {
    if (!year) return 0;
    if (todayMonth && todayMonth.slice(0, 4) === year) {
      return Math.min(11, Math.max(0, Number(todayMonth.slice(5)) - 1));
    }
    return 0;
  }, [year, todayMonth]);
  const autoStart = Math.max(
    0,
    Math.min(maxOffset, focusMonth - Math.floor(visibleCols / 2))
  );
  const safeOffset = Math.min(monthStartOverride ?? autoStart, maxOffset);
  const visibleMonths = useMemo(
    () => months.slice(safeOffset, safeOffset + visibleCols),
    [months, safeOffset, visibleCols]
  );
  // True when the current month is not part of the visible window.
  const currentMonthVisible =
    todayMonth.slice(0, 4) === year &&
    focusMonth >= safeOffset &&
    focusMonth < safeOffset + visibleCols;

  const showError = (e: unknown, fallback: string) => {
    setError(e instanceof Error ? e.message : fallback);
    window.setTimeout(() => setError(""), 5000);
  };
  const refreshClasses = useCallback(async () => {
    const list = await apiClasses.list();
    setClasses(list);
    return list;
  }, []);

  // Which (class, year) the currently loaded students/payments belong to.
  // The loading flag is derived from it, so no setState is needed in the effect body.
  const [detailKey, setDetailKey] = useState("");
  const currentKey = selectedClassId && year ? `${selectedClassId}|${year}` : "";
  const loadingDetail = currentKey !== "" && detailKey !== currentKey;

  const refreshDetail = useCallback(async (classId: string, y: string) => {
    try {
      const [st, pay] = await Promise.all([
        apiStudents.list(classId),
        apiPayments.listYear(classId, y),
      ]);
      setStudents(st);
      setPayments(pay);
      setDetailKey(`${classId}|${y}`);
    } catch (e) {
      showError(e, t("errDetail"));
    }
  }, [t]);

  // init: load classes once a session exists.
  // The setState calls live in promise callbacks, so nothing is set synchronously here.
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiClasses
      .list()
      .then((list) => {
        if (cancelled) return;
        setClasses(list);
        setLoadedUserId(user.id);
        if (list.length > 0) {
          setSelectedClassId(list[0].id);
        }
      })
      .catch(() => {
        // The session was rejected (expired and not refreshable) — sign out.
        if (!cancelled) void apiLogout();
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // load the selected class's students + payments whenever class or year changes
  useEffect(() => {
    if (!user || !selectedClassId || !year) return;
    let cancelled = false;
    Promise.all([apiStudents.list(selectedClassId), apiPayments.listYear(selectedClassId, year)])
      .then(([st, pay]) => {
        if (cancelled) return;
        setStudents(st);
        setPayments(pay);
        setDetailKey(`${selectedClassId}|${year}`);
      })
      .catch(() => {
        if (!cancelled) showError(new Error("Failed to load class details."), "Failed to load class details.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClassId, user, year]);

  // Ready once the session has been resolved and, if signed in, the user's
  // classes have loaded.
  const ready = sessionResolved && (!user || loadedUserId === user.id);

  // reload payments when the year changes (fetch is kicked off by the change handler)

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) ?? null,
    [classes, selectedClassId]
  );

  const paidMap = useMemo(() => {
    const m = new Map<string, boolean>(); // key: `${studentId}|${month}`
    for (const p of payments) m.set(`${p.studentId}|${p.month}`, p.paid);
    return m;
  }, [payments]);

  const paidKey = (studentId: string, m: string) => `${studentId}|${m}`;

  const paidCount = useMemo(() => payments.filter((p) => p.paid).length, [payments]);
  const yearSlots = students.length * 12;
  const totalStudents = useMemo(
    () => classes.reduce((a, c) => a + c.studentCount, 0),
    [classes]
  );

  // ---------------- auth ----------------
  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        await apiRegister(name.trim(), username.trim(), email.trim(), password, rememberMe);
      } else {
        await apiLogin(username.trim(), password, rememberMe);
      }
      setName("");
      setTypedUsername(null);
      setEmail("");
      setPassword("");
      const list = await refreshClasses();
      if (list.length > 0) {
        setSelectedClassId(list[0].id);
      }
    } catch (e) {
      showError(e, t("errAuth"));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    // Clearing the cookies is asynchronous, but the UI can update right away.
    void apiLogout();
    setClasses([]);
    setStudents([]);
    setPayments([]);
    setSelectedClassId(null);
    resetClassForm();
    resetStudentForm();
  }

  // ---------------- classes ----------------
  function resetClassForm() {
    setClassForm({ name: "", description: "", fee: "" });
    setEditingClassId(null);
  }

  async function submitClass(e: React.FormEvent) {
    e.preventDefault();
    if (!classForm.name.trim()) return;
    setBusy(true);
    try {
      const fee = Number(classForm.fee) || 0;
      if (editingClassId) {
        await apiClasses.update(editingClassId, classForm.name.trim(), classForm.description.trim(), fee);
      } else {
        const c = await apiClasses.create(classForm.name.trim(), classForm.description.trim(), fee);
        setSelectedClassId(c.id);
      }
      await refreshClasses();
      resetClassForm();
    } catch (e) {
      showError(e, t("errClass"));
    } finally {
      setBusy(false);
    }
  }

  function startEditClass(c: ClassItem) {
    setEditingClassId(c.id);
    setClassForm({ name: c.name, description: c.description, fee: String(c.fee) });
  }

  async function deleteClass(id: string) {
    if (!confirm(t("deleteClassConfirm"))) return;
    try {
      await apiClasses.remove(id);
      const list = await refreshClasses();
      if (selectedClassId === id) {
        const next = list[0]?.id ?? null;
        setSelectedClassId(next);
        if (!next) {
          setStudents([]);
          setPayments([]);
        }
      }
      if (editingClassId === id) resetClassForm();
    } catch (e) {
      showError(e, t("errDeleteClass"));
    }
  }

  function selectClass(id: string) {
    setSelectedClassId(id);
    resetStudentForm();
  }

  // ---------------- students ----------------
  function resetStudentForm() {
    setStudentForm({ name: "", phone: "", note: "" });
    setEditingStudentId(null);
  }

  // The names typed into the name field. A single name is the normal case;
  // several names separated by ";" are created in one go.
  const bulkNames = useMemo(
    () => splitStudentNames(studentForm.name),
    [studentForm.name]
  );
  const isBulk = bulkNames.length > 1;

  async function submitStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClassId || !studentForm.name.trim()) return;
    setBusy(true);
    try {
      if (editingStudentId) {
        // Editing always targets exactly one student.
        await apiStudents.update(
          editingStudentId,
          studentForm.name.trim(),
          studentForm.phone.trim(),
          studentForm.note.trim()
        );
      } else if (isBulk) {
        const res = await apiStudents.createBulk(
          selectedClassId,
          bulkNames,
          studentForm.phone.trim(),
          studentForm.note.trim()
        );
        if (res.skipped > 0) {
          setError(
            t("bulkSkipped", { n: res.skipped, total: bulkNames.length })
          );
          window.setTimeout(() => setError(""), 5000);
        }
      } else {
        await apiStudents.create(
          selectedClassId,
          studentForm.name.trim(),
          studentForm.phone.trim(),
          studentForm.note.trim()
        );
      }
      await refreshDetail(selectedClassId, year);
      await refreshClasses();
      resetStudentForm();
    } catch (e) {
      showError(e, t("errStudent"));
    } finally {
      setBusy(false);
    }
  }

  function startEditStudent(s: Student) {
    setEditingStudentId(s.id);
    setStudentForm({ name: s.name, phone: s.phone, note: s.note });
  }

  async function deleteStudent(id: string) {
    if (!selectedClassId || !confirm(t("removeStudentConfirm"))) return;
    try {
      await apiStudents.remove(id);
      await refreshDetail(selectedClassId, year);
      await refreshClasses();
      if (editingStudentId === id) resetStudentForm();
    } catch (e) {
      showError(e, t("errDeleteStudent"));
    }
  }

  async function togglePaid(studentId: string, m: string) {
    const key = paidKey(studentId, m);
    const next = !paidMap.get(key);
    // optimistic update
    setPayments((prev) => {
      const i = prev.findIndex((p) => p.studentId === studentId && p.month === m);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], paid: next };
        return copy;
      }
      return [...prev, { studentId, month: m, paid: next }];
    });
    try {
      await apiPayments.set(studentId, m, next);
    } catch (e) {
      showError(e, t("errPayment"));
      if (selectedClassId) refreshDetail(selectedClassId, year);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-600">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-[3px] border-indigo-200 border-t-indigo-600" />
          {t("loading")}
        </div>
      </div>
    );
  }

  // ---------------- login screen ----------------
  if (!user) {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-500 p-6">
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_25%_25%,white,transparent_40%),radial-gradient(circle_at_75%_75%,white,transparent_40%)]" />
        <div className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
          <div className="absolute top-6 right-6">
            <LangToggle lang={lang} onChange={setLang} />
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-2xl shadow-lg shadow-indigo-200">
            📚
          </div>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900">
            {t("appName")}
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-600">
            {mode === "login" ? t("welcomeBack") : t("createAccountIntro")}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError("");
                }}
                className={`rounded-lg py-2 transition ${
                  mode === m
                    ? "bg-white text-indigo-700 shadow"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {m === "login" ? t("login") : t("register")}
              </button>
            ))}
          </div>
          <form onSubmit={handleAuth} className="mt-5 space-y-3">
            {mode === "register" && (
              <div>
                <label className={labelCls}>{t("fullName")}</label>
                <input
                  className={inputCls}
                  placeholder={t("namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className={labelCls}>{t("username")}</label>
              <input
                className={inputCls}
                placeholder={t("usernamePlaceholder")}
                value={username}
                onChange={(e) => setTypedUsername(e.target.value)}
              />
            </div>
            {mode === "register" && (
              <div>
                <label className={labelCls}>{t("email")}</label>
                <input
                  className={inputCls}
                  placeholder="you@example.com"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className={labelCls}>{t("password")}</label>
              <input
                className={inputCls}
                placeholder="••••••••"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm font-medium text-slate-600 select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-indigo-600"
              />
              {t("rememberMe")}
            </label>
            {error && (
              <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-medium text-red-700">
                {error}
              </p>
            )}
            <button type="submit" className={`${btnPrimary} w-full py-3`} disabled={busy}>
              {busy ? <Spinner /> : mode === "login" ? t("loginBtn") : t("createAccountBtn")}
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-slate-400">
            {t("connectedApi")}
          </p>
          {/* Installing works before signing in, so the button lives here too. */}
          <div className="mt-3 flex justify-center">
            <InstallButton
              label={t("installApp")}
              iosLabel={t("installIosHint")}
              variant="light"
            />
          </div>
        </div>
      </div>
    );
  }

  const collected = selectedClass ? paidCount * Number(selectedClass.fee) : 0;

  // ---------------- main app ----------------
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-slate-100 text-slate-900">
      {/* error toast */}
      {error && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 shadow-xl">
          ⚠️ {error}
        </div>
      )}

      {/* header */}
      <header className="sticky top-0 z-10 bg-gradient-to-r from-indigo-700 via-indigo-600 to-violet-600 shadow-lg">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-xl backdrop-blur">
              📚
            </span>
            <span className="text-lg font-extrabold tracking-tight text-white">
              {t("appName")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <InstallButton label={t("installApp")} iosLabel={t("installIosHint")} />
            <LangToggle lang={lang} onChange={setLang} variant="dark" />
            <span className="hidden items-center gap-2 rounded-full bg-white/15 py-1.5 pr-4 pl-1.5 text-sm font-semibold text-white sm:flex">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white font-bold text-indigo-700">
                {user.name.charAt(0).toUpperCase()}
              </span>
              {user.name}
            </span>
            <button
              onClick={logout}
              className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow transition hover:bg-indigo-50 active:scale-[.97]"
            >
              {t("logOut")}
            </button>
          </div>
        </div>
      </header>

      {/* stat strip */}
      <div className="mx-auto grid w-full max-w-6xl grid-cols-3 gap-4 px-6 pt-6">
        {[
          { label: t("classes"), value: classes.length, icon: "🏫", bg: "from-indigo-500 to-indigo-600" },
          { label: t("students"), value: totalStudents, icon: "🎓", bg: "from-violet-500 to-purple-600" },
          { label: `${t("paid")} · ${year || "—"}`, value: `${paidCount}/${yearSlots}`, icon: "💰", bg: "from-emerald-500 to-teal-600" },
        ].map((s) => (
          <div key={s.label} className={`${card} overflow-hidden`}>
            <div className={`bg-gradient-to-r ${s.bg} px-4 py-3 text-white`}>
              <div className="text-2xl">{s.icon}</div>
              <div className="mt-1 text-2xl font-extrabold">{s.value}</div>
              <div className="text-xs font-semibold uppercase tracking-wider text-white/85">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-3 py-4 sm:px-6 sm:py-6 lg:flex-row">
        {/* classes column */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className={`${card} p-5`}>
            <h2 className="text-base font-extrabold text-slate-900">
              {editingClassId ? t("editClass") : t("newClass")}
            </h2>
            <form onSubmit={submitClass} className="mt-3 space-y-3">
              <div>
                <label className={labelCls}>{t("className")}</label>
                <input
                  className={inputCls}
                  placeholder={t("classNamePlaceholder")}
                  value={classForm.name}
                  onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls}>{t("description")}</label>
                <input
                  className={inputCls}
                  placeholder={t("descriptionPlaceholder")}
                  value={classForm.description}
                  onChange={(e) => setClassForm({ ...classForm, description: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls}>{t("monthlyFee")}</label>
                <input
                  className={inputCls}
                  placeholder={t("feePlaceholder")}
                  type="number"
                  min="0"
                  value={classForm.fee}
                  onChange={(e) => setClassForm({ ...classForm, fee: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className={`${btnPrimary} flex-1`} disabled={busy || !classForm.name.trim()}>
                  {busy ? <Spinner /> : editingClassId ? t("saveChanges") : t("createClass")}
                </button>
                {editingClassId && (
                  <button type="button" onClick={resetClassForm} className={btnGhost}>
                    {t("cancel")}
                  </button>
                )}
              </div>
            </form>
          </div>

          <h2 className="mt-5 mb-2 text-xs font-extrabold tracking-widest text-slate-500 uppercase">
            {t("myClasses")} · {classes.length}
          </h2>
          <div className="space-y-2.5">
            {classes.length === 0 && (
              <p className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-5 text-center text-sm font-medium text-slate-500">
                {t("noClassesYet")}
                <br />
                {t("createFirstClass")}
              </p>
            )}
            {classes.map((c) => {
              const active = c.id === selectedClassId;
              return (
                <div
                  key={c.id}
                  className={`rounded-2xl border-2 bg-white p-4 shadow-sm transition ${
                    active ? "border-indigo-500 shadow-md shadow-indigo-100" : "border-slate-200 hover:border-indigo-200"
                  }`}
                >
                  <button onClick={() => selectClass(c.id)} className="w-full text-left">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate font-bold text-slate-900">{c.name}</div>
                      {active && (
                        <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                          {t("active")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5">🎓 {c.studentCount}</span>
                      {Number(c.fee) > 0 && (
                        <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                          {Number(c.fee).toLocaleString()}{t("perMonth")}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="mt-2.5 flex gap-2">
                    <button onClick={() => startEditClass(c)} className={`${btnGhost} flex-1`}>
                      {t("edit")}
                    </button>
                    <button onClick={() => deleteClass(c.id)} className={`${btnDanger} flex-1`}>
                      {t("delete")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* students column */}
        <main className="min-w-0 flex-1">
          {!selectedClass ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-10 text-center">
              <div className="text-5xl">🎒</div>
              <p className="font-bold text-slate-800">{t("selectClassTitle")}</p>
              <p className="text-sm font-medium text-slate-500">
                {t("selectClassSubtitle")}
              </p>
            </div>
          ) : (
            <div className={`${card} p-3 sm:p-6`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
                    {selectedClass.name}
                  </h2>
                  {selectedClass.description && (
                    <p className="mt-0.5 text-sm font-medium text-slate-500">{selectedClass.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-bold text-slate-600">{t("year")}:</label>
                  <select
                    className={inputCls}
                    style={{ width: "auto" }}
                    value={year}
                    onChange={(e) => {
                      setYearOverride(e.target.value);
                      // A new year means a new month window; drop any manual
                      // page choice so the view follows the new year.
                      setMonthStartOverride(null);
                    }}
                  >
                    {year === "" && <option value="">—</option>}
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* payment summary */}
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-3.5 text-white shadow-md shadow-emerald-200">
                <span className="text-2xl">💰</span>
                <div className="text-sm">
                  <div className="font-extrabold">
                    {t("paidSummary", { year, paid: paidCount, slots: yearSlots })}
                  </div>
                  {Number(selectedClass.fee) > 0 && (
                    <div className="font-medium text-white/90">
                      {t("collected")} <b>{collected.toLocaleString()}</b>
                    </div>
                  )}
                </div>
                <div className="ml-auto h-2.5 w-40 overflow-hidden rounded-full bg-white/30">
                  <div
                    className="h-full rounded-full bg-white transition-all"
                    style={{ width: `${yearSlots ? (paidCount / yearSlots) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* add student */}
              <h3 className="mt-5 text-sm font-extrabold tracking-wide text-slate-700 uppercase">
                {editingStudentId ? t("editStudent") : t("addStudent")}
              </h3>
              <form onSubmit={submitStudent} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <div>
                  <input
                    className={inputCls}
                    placeholder={
                      editingStudentId
                        ? t("studentNamePlaceholder")
                        : t("studentNamePlaceholderBulk")
                    }
                    value={studentForm.name}
                    onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                  />
                  {/* Live preview of how many students will be created. */}
                  {!editingStudentId && isBulk && (
                    <p className="mt-1.5 text-xs font-semibold text-indigo-600">
                      {t("bulkCount", { n: bulkNames.length })}
                    </p>
                  )}
                </div>
                <input
                  className={inputCls}
                  placeholder={t("phone")}
                  value={studentForm.phone}
                  onChange={(e) => setStudentForm({ ...studentForm, phone: e.target.value })}
                />
                <input
                  className={inputCls}
                  placeholder={t("note")}
                  value={studentForm.note}
                  onChange={(e) => setStudentForm({ ...studentForm, note: e.target.value })}
                />
                <div className="flex gap-2">
                  <button type="submit" className={btnPrimary} disabled={busy || !studentForm.name.trim()}>
                    {busy ? (
                      <Spinner />
                    ) : editingStudentId ? (
                      t("save")
                    ) : isBulk ? (
                      t("addMany", { n: bulkNames.length })
                    ) : (
                      t("add")
                    )}
                  </button>
                  {editingStudentId && (
                    <button type="button" onClick={resetStudentForm} className={btnGhost}>
                      ✕
                    </button>
                  )}
                </div>
              </form>
              {!editingStudentId && (
                <p className="mt-1.5 text-xs text-slate-500">{t("bulkHint")}</p>
              )}

              {/* payment grid — 1 to 12 month columns depending on device width */}
              <div className="mt-4 rounded-2xl border border-slate-200" ref={gridRef}>
                <table className="w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col style={{ width: nameCol }} />
                    {visibleMonths.map((m) => (
                      <col key={m} style={{ width: phone ? cellWidth : undefined }} />
                    ))}
                    <col style={{ width: actionsCol }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 text-xs font-extrabold tracking-wider text-slate-600 uppercase">
                      <th className="truncate px-3 py-3">
                        {showShortHeaders ? t("studentShort") : t("student")}
                      </th>
                      {visibleMonths.map((m) => {
                        const mi = Number(m.slice(5)) - 1;
                        const isCurrent = todayMonth === m;
                        return (
                          <th
                            key={m}
                            title={monthLabels[mi]}
                            className={`truncate px-1 py-3 text-center text-[11px] tracking-tight ${
                              isCurrent ? "text-indigo-600" : ""
                            }`}
                          >
                            {showMonthNames ? monthLabels[mi] : mi + 1}
                          </th>
                        );
                      })}
                      <th className="truncate px-2 py-3 text-right">
                        {showShortHeaders ? t("actionsShort") : t("actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingDetail ? (
                      <tr>
                        <td colSpan={visibleMonths.length + 2} className="px-4 py-10 text-center font-medium text-slate-500">
                          {t("loadingStudents")}
                        </td>
                      </tr>
                    ) : (
                      students.map((s) => {
                        const paidMonths = months.filter((m) => paidMap.get(paidKey(s.id, m))).length;
                        return (
                          <tr key={s.id} className="transition hover:bg-slate-50">
                            <td className="px-3 py-2.5" title={[s.name, s.phone, s.note].filter(Boolean).join(" · ")}>
                              <span className="block truncate font-bold text-slate-900">{s.name}</span>
                              {(s.phone || s.note) && (
                                <span className="block truncate text-xs font-medium text-slate-500">
                                  {[s.phone, s.note].filter(Boolean).join(" · ")}
                                </span>
                              )}
                              <span className="mt-0.5 block text-[11px] font-semibold text-emerald-600">
                                {t("paidOf12", { n: paidMonths })}
                              </span>
                            </td>
                            {visibleMonths.map((m) => {
                              const paid = !!paidMap.get(paidKey(s.id, m));
                              const isCurrent = todayMonth === m;
                              const mi = Number(m.slice(5)) - 1;
                              const monthName = monthLabels[mi];
                              return (
                                <td key={m} className="px-1 py-1.5 text-center">
                                  <button
                                    onClick={() => togglePaid(s.id, m)}
                                    title={t("cellTitle", {
                                      month: monthName,
                                      year,
                                      name: s.name,
                                      action: paid ? t("markUnpaid") : t("markPaid"),
                                    })}
                                    aria-label={t("cellLabel", {
                                      month: monthName,
                                      year,
                                      name: s.name,
                                    })}
                                    aria-pressed={paid}
                                    style={
                                      phone
                                        ? {
                                            width: buttonWidth,
                                            height: buttonWidth,
                                            borderRadius: 6,
                                          }
                                        : undefined
                                    }
                                    className={`flex items-center justify-center border-2 text-xs font-bold transition active:scale-95 ${
                                      phone ? "mx-auto" : "h-8 w-full rounded-md"
                                    } ${
                                      paid
                                        ? "border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-200"
                                        : isCurrent
                                          ? "border-indigo-300 bg-indigo-50 text-transparent hover:border-emerald-400 hover:bg-emerald-50"
                                          : "border-slate-200 bg-white text-transparent hover:border-emerald-300 hover:bg-emerald-50"
                                    }`}
                                  >
                                    {paid ? "✓" : ""}
                                  </button>
                                </td>
                              );
                            })}
                            <td className="px-2 py-2.5 text-right whitespace-nowrap">
                              {compact ? (
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => startEditStudent(s)}
                                    aria-label={t("edit")}
                                    title={t("edit")}
                                    style={
                                      actionButtonWidth
                                        ? {
                                            width: actionButtonWidth,
                                            height: actionButtonWidth,
                                            // The zeroed padding makes the size
                                            // exact — the button classes carry
                                            // conflicting `px-2`/`px-3`, and
                                            // Tailwind's stylesheet order (not
                                            // the class order) decides which
                                            // one wins.
                                            padding: 0,
                                          }
                                        : undefined
                                    }
                                    className={`${btnGhost} px-2 py-1`}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    onClick={() => deleteStudent(s.id)}
                                    aria-label={t("delete")}
                                    title={t("delete")}
                                    style={
                                      actionButtonWidth
                                        ? {
                                            width: actionButtonWidth,
                                            height: actionButtonWidth,
                                            // See the note on the edit button
                                            // above.
                                            padding: 0,
                                          }
                                        : undefined
                                    }
                                    className={`${btnDanger} px-2 py-1`}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => startEditStudent(s)}
                                    className={`${btnGhost} flex-1 truncate px-2`}
                                  >
                                    {t("edit")}
                                  </button>
                                  <button
                                    onClick={() => deleteStudent(s.id)}
                                    className={`${btnDanger} flex-1 truncate px-2`}
                                  >
                                    {t("delete")}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                    {!loadingDetail && students.length === 0 && (
                      <tr>
                        <td colSpan={visibleMonths.length + 2} className="px-4 py-10 text-center">
                          <div className="text-4xl">👋</div>
                          <p className="mt-2 font-bold text-slate-700">{t("noStudentsYet")}</p>
                          <p className="text-sm font-medium text-slate-500">{t("addFirstStudent")}</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* month pager — only shown when not all 12 months fit */}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">
                  {t("tip")}
                </p>
                {maxOffset > 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setMonthStartOverride(Math.max(0, safeOffset - visibleCols))}
                      disabled={safeOffset === 0}
                      aria-label={t("prevMonths")}
                      className={`${btnGhost} disabled:opacity-40`}
                    >
                      ←
                    </button>
                    <span className="px-1 text-xs font-bold text-slate-600">
                      {monthLabels[safeOffset]} – {monthLabels[Math.min(11, safeOffset + visibleCols - 1)]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMonthStartOverride(Math.min(maxOffset, safeOffset + visibleCols))}
                      disabled={safeOffset >= maxOffset}
                      aria-label={t("nextMonths")}
                      className={`${btnGhost} disabled:opacity-40`}
                    >
                      →
                    </button>
                    {!currentMonthVisible && (
                      <button
                        type="button"
                        onClick={() => setMonthStartOverride(null)}
                        className={`${btnGhost} ml-1`}
                      >
                        {t("today")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="mx-auto w-full max-w-6xl px-6 pb-6 text-center text-xs font-medium text-slate-400">
        {t("footer")}
      </footer>
    </div>
  );
}
