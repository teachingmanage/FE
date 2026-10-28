"use client";

// ---------------- language store ----------------
// The language is stored in localStorage and exposed through
// useSyncExternalStore, so switching it re-renders without a full reload and
// without a setState-in-effect.
export type Lang = "en" | "vi";

const LANG_KEY = "teaching-lang";
const LANG_EVENT = "teaching-lang-changed";

let cachedRaw: string | null = null;
let cachedLang: Lang = "en";

export function getLangSnapshot(): Lang {
  if (typeof window === "undefined") return "en";
  const raw = localStorage.getItem(LANG_KEY);
  if (raw === cachedRaw) return cachedLang;
  cachedRaw = raw;
  cachedLang = raw === "vi" ? "vi" : "en";
  return cachedLang;
}

export function getServerLangSnapshot(): Lang {
  return "en";
}

export function subscribeLang(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener(LANG_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(LANG_EVENT, cb);
  };
}

export function setLang(lang: Lang) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LANG_KEY, lang);
  cachedRaw = null;
  window.dispatchEvent(new Event(LANG_EVENT));
}

// ---------------- translations ----------------
export const MONTH_LABELS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  vi: ["Th1", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7", "Th8", "Th9", "Th10", "Th11", "Th12"],
};

const en = {
  appName: "Teaching Manager",
  loading: "Loading…",

  // auth
  login: "Log in",
  register: "Sign up",
  welcomeBack: "Welcome back — log in to manage your classes.",
  createAccountIntro: "Create an account to start managing your classes.",
  fullName: "Full name",
  username: "Username",
  email: "Email",
  password: "Password",
  loginBtn: "Log in →",
  createAccountBtn: "Create account →",
  logOut: "Log out",
  rememberMe: "Keep me signed in",
  installApp: "Install",
  installIosHint:
    "To install this app on iPhone or iPad, tap the Share button in Safari and then choose “Add to Home Screen”.",
  // `{api}` is replaced with the address of the backend the app talks to.
  connectedApi: "Connected to API · {api}",
  namePlaceholder: "e.g. Nguyen Van A",
  usernamePlaceholder: "e.g. teacher01",

  // header / stats
  classes: "Classes",
  students: "Students",
  paid: "Paid",
  language: "Language",

  // class form
  newClass: "➕ New class",
  editClass: "✏️ Edit class",
  className: "Class name",
  description: "Description",
  monthlyFee: "Monthly fee",
  classNamePlaceholder: "e.g. English Grade 10",
  descriptionPlaceholder: "Schedule, room…",
  feePlaceholder: "0",
  saveChanges: "Save changes",
  createClass: "Create class",
  cancel: "Cancel",

  // class list
  myClasses: "My classes",
  noClassesYet: "No classes yet.",
  createFirstClass: "Create your first class above 👆",
  active: "ACTIVE",
  perMonth: "/mo",
  edit: "Edit",
  delete: "Delete",

  // student panel
  selectClassTitle: "Select a class to get started",
  selectClassSubtitle: "Pick a class on the left to manage its students and monthly payments.",
  year: "Year",
  paidSummary: "{year} · {paid}/{slots} paid",
  collected: "Collected:",
  editStudent: "✏️ Edit student",
  addStudent: "➕ Add student",
  studentNamePlaceholder: "Student name *",
  studentNamePlaceholderBulk: "Name; Name; Name…",
  bulkHint: "Tip: separate several names with \";\" to add them all at once.",
  bulkCount: "{n} students will be created",
  addMany: "Add {n} students",
  bulkSkipped: "{n} of {total} students already existed and were skipped.",
  phone: "Phone",
  note: "Note",
  save: "Save",
  add: "Add",

  // grid
  student: "Student",
  studentShort: "Name",
  actions: "Actions",
  actionsShort: "⋯",
  loadingStudents: "Loading students…",
  noStudentsYet: "No students yet",
  addFirstStudent: "Add the first student above.",
  tip: "Tip: click a cell to toggle that month. Green = paid.",
  today: "Today",
  prevMonths: "Previous months",
  nextMonths: "Next months",
  paidOf12: "{n}/12 paid",
  markPaid: "mark paid",
  markUnpaid: "mark unpaid",
  cellTitle: "{month} {year} — {name}: {action}",
  cellLabel: "{month} {year} paid for {name}",

  // errors
  errAuth: "Authentication failed.",
  errClass: "Failed to save class.",
  errDeleteClass: "Failed to delete class.",
  errStudent: "Failed to save student.",
  errDeleteStudent: "Failed to delete student.",
  errPayment: "Failed to update payment.",
  errDetail: "Failed to load class details.",
  deleteClassConfirm: "Delete this class and all its students?",
  removeStudentConfirm: "Remove this student?",

  footer: "Teaching Manager · API: {api} · data stored in Postgres",
} as const;

const vi = {
  appName: "Quản lý Giảng dạy",
  loading: "Đang tải…",

  // auth
  login: "Đăng nhập",
  register: "Đăng ký",
  welcomeBack: "Chào mừng trở lại — đăng nhập để quản lý lớp học.",
  createAccountIntro: "Tạo tài khoản để bắt đầu quản lý lớp học.",
  fullName: "Họ và tên",
  username: "Tên đăng nhập",
  email: "Email",
  password: "Mật khẩu",
  loginBtn: "Đăng nhập →",
  createAccountBtn: "Tạo tài khoản →",
  logOut: "Đăng xuất",
  rememberMe: "Ghi nhớ đăng nhập",
  installApp: "Cài đặt",
  installIosHint:
    "Để cài app này trên iPhone hoặc iPad, hãy bấm nút Chia sẻ trong Safari rồi chọn “Thêm vào Màn hình chính”.",
  // `{api}` is replaced with the address of the backend the app talks to.
  connectedApi: "Đã kết nối API · {api}",
  namePlaceholder: "VD: Nguyễn Văn A",
  usernamePlaceholder: "VD: giaovien01",

  // header / stats
  classes: "Lớp học",
  students: "Học sinh",
  paid: "Đã đóng",
  language: "Ngôn ngữ",

  // class form
  newClass: "➕ Lớp mới",
  editClass: "✏️ Sửa lớp",
  className: "Tên lớp",
  description: "Mô tả",
  monthlyFee: "Học phí tháng",
  classNamePlaceholder: "VD: Tiếng Anh Lớp 10",
  descriptionPlaceholder: "Lịch học, phòng…",
  feePlaceholder: "0",
  saveChanges: "Lưu thay đổi",
  createClass: "Tạo lớp",
  cancel: "Huỷ",

  // class list
  myClasses: "Lớp của tôi",
  noClassesYet: "Chưa có lớp nào.",
  createFirstClass: "Tạo lớp đầu tiên ở trên 👆",
  active: "ĐANG CHỌN",
  perMonth: "/tháng",
  edit: "Sửa",
  delete: "Xoá",

  // student panel
  selectClassTitle: "Chọn một lớp để bắt đầu",
  selectClassSubtitle: "Chọn lớp bên trái để quản lý học sinh và học phí hàng tháng.",
  year: "Năm",
  paidSummary: "{year} · {paid}/{slots} đã đóng",
  collected: "Đã thu:",
  editStudent: "✏️ Sửa học sinh",
  addStudent: "➕ Thêm học sinh",
  studentNamePlaceholder: "Tên học sinh *",
  studentNamePlaceholderBulk: "Tên; Tên; Tên…",
  bulkHint: "Mẹo: dùng \";\" để tách nhiều tên và thêm tất cả một lúc.",
  bulkCount: "Sẽ tạo {n} học sinh",
  addMany: "Thêm {n} học sinh",
  bulkSkipped: "{n} trong {total} học sinh đã tồn tại và được bỏ qua.",
  phone: "Điện thoại",
  note: "Ghi chú",
  save: "Lưu",
  add: "Thêm",

  // grid
  student: "Học sinh",
  studentShort: "Tên",
  actions: "Thao tác",
  actionsShort: "⋯",
  loadingStudents: "Đang tải học sinh…",
  noStudentsYet: "Chưa có học sinh",
  addFirstStudent: "Thêm học sinh đầu tiên ở trên.",
  tip: "Mẹo: bấm vào ô để đánh dấu tháng. Màu xanh = đã đóng.",
  today: "Tháng này",
  prevMonths: "Các tháng trước",
  nextMonths: "Các tháng sau",
  paidOf12: "{n}/12 đã đóng",
  markPaid: "đánh dấu đã đóng",
  markUnpaid: "đánh dấu chưa đóng",
  cellTitle: "{month} {year} — {name}: {action}",
  cellLabel: "{month} {year} đã đóng cho {name}",

  // errors
  errAuth: "Đăng nhập thất bại.",
  errClass: "Không lưu được lớp học.",
  errDeleteClass: "Không xoá được lớp học.",
  errStudent: "Không lưu được học sinh.",
  errDeleteStudent: "Không xoá được học sinh.",
  errPayment: "Không cập nhật được học phí.",
  errDetail: "Không tải được chi tiết lớp học.",
  deleteClassConfirm: "Xoá lớp này và toàn bộ học sinh?",
  removeStudentConfirm: "Xoá học sinh này?",

  footer: "Quản lý Giảng dạy · API: {api} · dữ liệu lưu trong Postgres",
} as const;

export type TranslationKey = keyof typeof en;

const dicts: Record<Lang, Record<TranslationKey, string>> = { en, vi };

export function translate(
  lang: Lang,
  key: TranslationKey,
  vars?: Record<string, string | number>
): string {
  const dict = dicts[lang] ?? dicts.en;
  let out: string = dict[key] ?? dicts.en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(String(v));
    }
  }
  return out;
}

export function localeFor(lang: Lang): string {
  return lang === "vi" ? "vi-VN" : "en-US";
}
