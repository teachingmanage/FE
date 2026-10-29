"use client";

import { useMemo, useRef, useState } from "react";
import {
  ScanPaymentRow,
  Student,
  apiPayments,
  apiScanPayments,
  apiStudents,
  normalizeName,
} from "./teaching";
import type { TranslationKey } from "./i18n";

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

type EditableRow = {
  key: number;
  name: string;
  paid: boolean[];
  confidence: number;
  note: string;
  matchedId: string | null;
  enabled: boolean;
};

function matchStudent(name: string, students: Student[]): Student | null {
  const norm = normalizeName(name);
  if (!norm) return null;
  // Exact normalized match first.
  for (const s of students) {
    if (normalizeName(s.name) === norm) return s;
  }
  // Then "contains" match (scan often drops middle names or adds noise).
  let best: Student | null = null;
  for (const s of students) {
    const sn = normalizeName(s.name);
    if (sn.includes(norm) || norm.includes(sn)) {
      if (!best || s.name.length < best.name.length) best = s;
    }
  }
  return best;
}

export function ScanPaymentsModal({
  classId,
  year,
  students,
  monthLabels,
  t,
  onClose,
  onApplied,
}: {
  classId: string;
  year: string;
  students: Student[];
  monthLabels: string[];
  t: TFn;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState("");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [scanned, setScanned] = useState(false);

  const studentByNorm = useMemo(() => {
    const m = new Map<string, Student>();
    for (const s of students) m.set(normalizeName(s.name), s);
    return m;
  }, [students]);
  void studentByNorm;

  function pickFile(f: File | null) {
    if (!f) return;
    setFile(f);
    setRows([]);
    setScanned(false);
    setError("");
    const url = URL.createObjectURL(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }

  async function runScan() {
    if (!file || scanning) return;
    setScanning(true);
    setError("");
    try {
      const res = await apiScanPayments(
        file,
        year,
        students.map((s) => s.name)
      );
      const mapped: EditableRow[] = (res.rows as ScanPaymentRow[]).map((r, i) => {
        const paid = Array.from({ length: 12 }, (_, mi) => r.paidMonths.includes(mi + 1));
        const hit = matchStudent(r.name, students);
        return {
          key: i,
          name: hit ? hit.name : r.name,
          paid,
          confidence: r.confidence,
          note: r.note,
          matchedId: hit ? hit.id : null,
          enabled: true,
        };
      });
      setRows(mapped);
      setScanned(true);
      if (mapped.length === 0) setError(t("scanNoRows"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("scanNoRows");
      setError(msg.includes("GEMINI_API_KEY") ? t("scanNoKey") : msg);
    } finally {
      setScanning(false);
    }
  }

  function toggleCell(key: number, mi: number) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, paid: r.paid.map((p, i) => (i === mi ? !p : p)) } : r))
    );
  }

  function setRowName(key: number, name: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const hit = matchStudent(name, students);
        return { ...r, name, matchedId: hit ? hit.id : null };
      })
    );
  }

  const activeRows = rows.filter((r) => r.enabled && r.name.trim());
  const newCount = activeRows.filter((r) => !r.matchedId).length;
  const paidCells = activeRows.reduce((a, r) => a + r.paid.filter(Boolean).length, 0);

  async function pushToWeb() {
    if (pushing || activeRows.length === 0 || paidCells === 0) return;
    setPushing(true);
    setError("");
    try {
      // Resolve every row to a student id — create the new ones first.
      const idByKey = new Map<number, string>();
      for (const r of activeRows) {
        if (r.matchedId) {
          idByKey.set(r.key, r.matchedId);
          continue;
        }
        setPushProgress(`${r.name}…`);
        const created = await apiStudents.create(classId, r.name.trim(), "", "");
        students.push(created);
        idByKey.set(r.key, created.id);
      }
      // Push every checked cell as paid. Batches keep the backend happy.
      const jobs: { id: string; month: string }[] = [];
      for (const r of activeRows) {
        const id = idByKey.get(r.key);
        if (!id) continue;
        r.paid.forEach((on, mi) => {
          if (on) jobs.push({ id, month: `${year}-${String(mi + 1).padStart(2, "0")}` });
        });
      }
      let done = 0;
      const BATCH = 12;
      for (let i = 0; i < jobs.length; i += BATCH) {
        const batch = jobs.slice(i, i + BATCH);
        await Promise.all(batch.map((j) => apiPayments.set(j.id, j.month, true)));
        done += batch.length;
        setPushProgress(`${done}/${jobs.length}`);
      }
      const studentCount = new Set(jobs.map((j) => j.id)).size;
      onApplied(t("scanApplied", { paid: jobs.length, students: studentCount }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Push failed.");
    } finally {
      setPushing(false);
      setPushProgress("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-slate-900">{t("scanTitle")}</h2>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm font-medium text-slate-500">{t("scanPick")}</p>
        <p className="mt-0.5 text-xs text-slate-400">{t("scanHowto")}</p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:from-indigo-500 hover:to-violet-500"
          >
            {preview ? `📷 ${t("scanChange")}` : `📷 ${t("scanTitle")}`}
          </button>
          {file && (
            <button
              type="button"
              onClick={runScan}
              disabled={scanning}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-200 transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {scanning ? t("scanReading") : `✨ ${t("scanRead")}`}
            </button>
          )}
          {scanning && (
            <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
          )}
        </div>

        {preview && (
          <img
            src={preview}
            alt="payment table"
            className="mt-3 max-h-56 w-full rounded-xl border border-slate-200 object-contain bg-slate-50"
          />
        )}

        {error && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        {scanned && rows.length > 0 && (
          <>
            <p className="mt-3 text-xs font-medium text-slate-500">{t("scanLowConfidence")}</p>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                    <th className="px-2 py-2">✓</th>
                    <th className="px-2 py-2">Student</th>
                    {monthLabels.map((l, i) => (
                      <th key={i} className="px-1 py-2 text-center">{l}</th>
                    ))}
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const uncertain = r.confidence < 0.6;
                    return (
                      <tr key={r.key} className={uncertain ? "bg-amber-50" : undefined}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={() =>
                              setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, enabled: !x.enabled } : x)))
                            }
                            className="h-4 w-4 accent-indigo-600"
                          />
                        </td>
                        <td className="min-w-[140px] px-2 py-1.5">
                          <input
                            value={r.name}
                            onChange={(e) => setRowName(r.key, e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
                          />
                          <div className="mt-0.5">
                            {r.matchedId ? (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                ✓ {t("scanMatched")}
                              </span>
                            ) : (
                              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                                + {t("scanNew")}
                              </span>
                            )}
                            {uncertain && (
                              <span className="ml-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                {t("scanUncertain")}
                              </span>
                            )}
                          </div>
                        </td>
                        {r.paid.map((on, mi) => (
                          <td key={mi} className="px-1 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => toggleCell(r.key, mi)}
                              aria-pressed={on}
                              className={`mx-auto flex h-6 w-6 items-center justify-center rounded-md border-2 text-[11px] font-bold transition active:scale-95 ${
                                on
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : "border-slate-200 bg-white text-transparent hover:border-emerald-300"
                              }`}
                            >
                              ✓
                            </button>
                          </td>
                        ))}
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            title={t("scanRemoveRow")}
                            onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                            className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-600">{t("scanPaidCells", { n: paidCells })}</span>
              {newCount > 0 && (
                <span className="text-xs font-bold text-indigo-600">{t("scanNewStudents", { n: newCount })}</span>
              )}
              {pushProgress && <span className="text-xs font-bold text-slate-500">{pushProgress}</span>}
              <button
                type="button"
                onClick={pushToWeb}
                disabled={pushing || paidCells === 0}
                className="ml-auto rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-200 transition hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50"
              >
                {pushing ? pushProgress || "…" : `⬆ ${t("scanApply", { n: paidCells })}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
