import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My DTR · OJT Attendance" },
      {
        name: "description",
        content:
          "Punch in, break out, break in, and check out. Your daily time record is saved to your account.",
      },
    ],
  }),
  component: DashboardPage,
});

type Punch = "check_in" | "break_out" | "break_in" | "check_out";

type DtrRow = {
  id?: string;
  user_id?: string;
  entry_date: string;
  check_in: string | null;
  break_out: string | null;
  break_in: string | null;
  check_out: string | null;
};

type Profile = {
  full_name: string | null;
  student_id: string | null;
  company: string | null;
  is_admin?: boolean;
};

type TraineeRow = {
  id: string;
  full_name: string | null;
  student_id: string | null;
  company: string | null;
};

const ORDER: Punch[] = ["check_in", "break_out", "break_in", "check_out"];
const LABELS: Record<Punch, string> = {
  check_in: "Check In",
  break_out: "Break Out",
  break_in: "Break In",
  check_out: "Check Out",
};

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ── Attendance schedule config ──────────────────────────────────────────────
// 8:00 AM – 11:59 AM = Check In window. All punches are now manual — the
// trainee taps each button themselves; nothing is auto-logged.
const CHECK_IN_START_HOUR = 8; // 8:00 AM
const CHECK_IN_END_HOUR = 12; // Check In allowed until 11:59 AM (exclusive of 12:00)

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function computeHours(r: DtrRow) {
  if (!r.check_in || !r.check_out) return 0;
  const ci = new Date(r.check_in).getTime();
  const co = new Date(r.check_out).getTime();
  let breakMs = 0;
  if (r.break_out && r.break_in) {
    breakMs = Math.max(
      0,
      new Date(r.break_in).getTime() - new Date(r.break_out).getTime(),
    );
  }
  return Math.max(0, co - ci - breakMs) / 3_600_000;
}

function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// Filter a set of DTR rows down to only the ones that fall within the given
// month/year. Used to keep the on-screen table in sync with whatever
// month/year is selected in the dropdowns (instead of always showing every
// row ever logged).
function filterRowsByMonth<T extends DtrRow>(
  rows: T[],
  targetMonth: number,
  targetYear: number,
): T[] {
  return rows.filter((r) => {
    const d = new Date(r.entry_date + "T00:00:00");
    return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
  });
}

const EMPTY_PROFILE: Profile = { full_name: "", student_id: "", company: "", is_admin: false };

// ── Shared DTR document builder ─────────────────────────────────────────────
// Pulled out as standalone functions (not tied to component state) so both
// the trainee's own dashboard AND the admin's per-trainee view can generate
// the same printable/downloadable DTR document.
function buildDtrHtmlFor(fullName: string, rows: DtrRow[], targetMonth: number, targetYear: number) {
  const byDay: Record<number, DtrRow> = {};
  for (const r of rows) {
    const d = new Date(r.entry_date + "T00:00:00");
    if (d.getMonth() === targetMonth && d.getFullYear() === targetYear) {
      byDay[d.getDate()] = r;
    }
  }

  const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const isWeekend = (day: number) => {
    const dow = new Date(targetYear, targetMonth, day).getDay();
    return dow === 0 || dow === 6;
  };

  const rows31: string[] = [];
  for (let day = 1; day <= 31; day++) {
    const row = day <= daysInMonth ? byDay[day] : null;
    const weekend = day <= daysInMonth && isWeekend(day);
    const color = weekend ? "#cc0000" : "#000000";
    const amIn  = row ? hhmm(row.check_in)  : "";
    const amOut = row ? hhmm(row.break_out) : "";
    const pmIn  = row ? hhmm(row.break_in)  : "";
    const pmOut = row ? hhmm(row.check_out) : "";
    rows31.push(`
      <tr>
        <td style="color:${color};text-align:center;font-size:8.5px;padding:0 2px;">${day <= daysInMonth ? day : ""}</td>
        <td style="font-size:7.5px;text-align:center;padding:0 1px;">${amIn}</td>
        <td style="font-size:7.5px;text-align:center;padding:0 1px;">${amOut}</td>
        <td style="font-size:7.5px;text-align:center;padding:0 1px;">${pmIn}</td>
        <td style="font-size:7.5px;text-align:center;padding:0 1px;">${pmOut}</td>
      </tr>
    `);
  }

  const monthLabel = `${MONTHS[targetMonth]} ${targetYear}`;

  const copy = `
    <div class="copy">
      <div class="title-wrap"><h1>DAILY TIME RECORD</h1></div>
      <div class="name-block">
        <div class="name-value">${fullName}</div>
      </div>
      <div class="month-line">For the month of: &nbsp;<strong>${monthLabel}</strong></div>
      <table>
        <thead>
          <tr>
            <th rowspan="2" style="width:20px;">Day</th>
            <th colspan="2">AM</th>
            <th colspan="2">PM</th>
          </tr>
          <tr>
            <th>Time In</th><th>Time Out</th>
            <th>Time In</th><th>Time Out</th>
          </tr>
        </thead>
        <tbody>${rows31.join("")}</tbody>
      </table>
      <div class="cert">
        I CERTIFY on my honor that above is a true and correct<br/>
        report of the hours of work performed, record of which was made<br/>
        daily at the time of arrival at and departure from office.
      </div>
      <div class="trainee-sig">
        <div class="sig-line"></div>
        <div class="sig-name">${fullName}</div>
      </div>
      <div class="verified">Verified as to the prescribed office hours.</div>
      <div class="supervisor-sig">
        <div class="sig-name">JOSE B. TUASON JR.</div>
        <div class="sig-line"></div>
        <div class="sig-title">CHIEF ADMINISTRATIVE OFFICER</div>
      </div>
    </div>
  `;

  const styles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4 portrait; margin: 10mm 8mm; }
    html, body { height: 100%; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #000; height: 100%; }
    .page { display: flex; flex-direction: row; width: 100%; min-height: 257mm; }
    .copy { width: 50%; padding: 4mm 6mm; border-right: 1px dashed #bbb; display: flex; flex-direction: column; }
    .copy:last-child { border-right: none; }
    .title-wrap { border-top: 2.5px double #000; border-bottom: 2.5px double #000; padding: 3px 0; margin-bottom: 6px; }
    h1 { font-size: 15px; font-weight: 900; text-align: center; letter-spacing: 1.5px; }
    .name-block { text-align: center; margin-bottom: 1px; }
    .name-value { font-size: 12px; font-weight: bold; border-bottom: 1px solid #000; display: inline-block; min-width: 160px; padding: 0 8px; text-align: center; }
    .name-label { font-size: 8px; text-align: center; color: #c00; margin-bottom: 5px; }
    .month-line { font-size: 9px; margin-bottom: 5px; }
    .month-line strong { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; }
    table, th, td { border: 1px solid #000; }
    th { font-size: 8px; text-align: center; padding: 2px 0; font-weight: bold; }
    td { height: 13px; }
    .cert { font-size: 8px; margin-top: 10px; line-height: 1.6; text-align: center; }
    .trainee-sig { margin-top: 10px; text-align: center; }
    .trainee-sig .sig-line { border-top: 1px solid #000; width: 80%; margin: 0 auto 2px; }
    .trainee-sig .sig-name { font-size: 10px; font-weight: bold; }
    .verified { font-size: 7.5px; margin-top: 6px; margin-bottom: 8px; }
    .supervisor-sig { text-align: center; }
    .supervisor-sig .sig-name { font-size: 10px; font-weight: bold; margin-bottom: 1px; }
    .supervisor-sig .sig-line { border-top: 2.5px solid #000; width: 80%; margin: 0 auto 2px; }
    .supervisor-sig .sig-title { font-size: 9px; font-weight: bold; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>DTR – ${monthLabel}</title>
<style>${styles}</style>
</head>
<body>
<div class="page">${copy}${copy}</div>
</body>
</html>`;

  return { html, monthLabel };
}

function printDtrFor(fullName: string, rows: DtrRow[], targetMonth: number, targetYear: number) {
  const { html } = buildDtrHtmlFor(fullName, rows, targetMonth, targetYear);
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:0;height:0;border:none;position:absolute;left:-9999px;top:-9999px;";
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
  };
}

function downloadWordDtrFor(fullName: string, rows: DtrRow[], targetMonth: number, targetYear: number) {
  const monthLabel = `${MONTHS[targetMonth]} ${targetYear}`;

  const byDay: Record<number, DtrRow> = {};
  for (const r of rows) {
    const d = new Date(r.entry_date + "T00:00:00");
    if (d.getMonth() === targetMonth && d.getFullYear() === targetYear) {
      byDay[d.getDate()] = r;
    }
  }

  const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const isWeekend = (day: number) => {
    const dow = new Date(targetYear, targetMonth, day).getDay();
    return dow === 0 || dow === 6;
  };

  const cell = (txt: string, extra = "") =>
    `<td style="border:1px solid #000;font-size:7.5pt;text-align:center;vertical-align:middle;padding:1px 2px;height:14px;${extra}">${txt}</td>`;

  const hdrCell = (txt: string, extra = "") =>
    `<td style="border:1px solid #000;font-size:7.5pt;font-weight:bold;text-align:center;vertical-align:middle;padding:2px;${extra}">${txt}</td>`;

  let rows31 = "";
  for (let day = 1; day <= 31; day++) {
    const row = day <= daysInMonth ? byDay[day] : null;
    const weekend = day <= daysInMonth && isWeekend(day);
    const col = weekend ? "color:#cc0000;" : "";
    const dl = day <= daysInMonth ? String(day) : "";
    const a1 = row ? hhmm(row.check_in) : "";
    const a2 = row ? hhmm(row.break_out) : "";
    const p1 = row ? hhmm(row.break_in) : "";
    const p2 = row ? hhmm(row.check_out) : "";
    rows31 += `<tr>
      ${cell(dl, col)}
      ${cell(a1)}
      ${cell(a2)}
      ${cell(p1)}
      ${cell(p2)}
    </tr>`;
  }

  const makeCopy = () => `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-family:Arial,sans-serif;">
<colgroup>
  <col style="width:13%;"/>
  <col style="width:21.75%;"/>
  <col style="width:21.75%;"/>
  <col style="width:21.75%;"/>
  <col style="width:21.75%;"/>
</colgroup>
<tr>
  <td colspan="5" style="
    border-top:2.5pt double #000;
    border-bottom:2.5pt double #000;
    border-left:none;border-right:none;
    text-align:center;
    font-size:13pt;
    font-weight:bold;
    letter-spacing:1.5pt;
    padding:4px 0;
    font-family:Arial,sans-serif;
  ">DAILY TIME RECORD</td>
</tr>
<tr>
  <td colspan="5" style="
    text-align:center;
    font-size:10pt;
    font-weight:bold;
    border-bottom:1px solid #000;
    border-top:none;border-left:none;border-right:none;
    padding:3px 0 1px;
    font-family:Arial,sans-serif;
  ">${fullName}</td>
</tr>
<tr>
  <td colspan="5" style="
    font-size:8pt;
    border:none;
    padding:3px 0 4px;
    font-family:Arial,sans-serif;
  ">For the month of: &nbsp;<strong>${monthLabel}</strong></td>
</tr>
<tr>
  <td rowspan="2" style="
    border:1px solid #000;
    font-size:7.5pt;
    font-weight:bold;
    text-align:center;
    vertical-align:middle;
    padding:2px;
  ">Day</td>
  <td colspan="2" style="
    border:1px solid #000;
    font-size:7.5pt;
    font-weight:bold;
    text-align:center;
    vertical-align:middle;
    padding:2px;
  ">AM</td>
  <td colspan="2" style="
    border:1px solid #000;
    font-size:7.5pt;
    font-weight:bold;
    text-align:center;
    vertical-align:middle;
    padding:2px;
  ">PM</td>
</tr>
<tr>
  ${hdrCell("Time In")}
  ${hdrCell("Time Out")}
  ${hdrCell("Time In")}
  ${hdrCell("Time Out")}
</tr>
${rows31}
<tr>
  <td colspan="5" style="
    font-size:6.5pt;
    text-align:center;
    vertical-align:middle;
    border:none;
    padding:10px 4px 4px;
    line-height:1.8;
    font-family:Arial,sans-serif;
  ">
    I CERTIFY on my honor that above is a true and correct<br/>
    report of the hours of work performed, record of which was made<br/>
    daily at the time of arrival at and departure from office.
  </td>
</tr>
<tr>
  <td colspan="5" style="border:none;padding:20px 0 0;text-align:center;">
    <table style="width:80%;margin:0 auto;border-collapse:collapse;">
      <tr>
        <td style="border-top:1px solid #000;text-align:center;font-size:9.5pt;font-weight:bold;padding:4px 0 2px;font-family:Arial,sans-serif;">
          ${fullName}
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td colspan="5" style="
    border:none;
    font-size:7.5pt;
    padding:6px 0 16px;
    text-align:center;
    font-family:Arial,sans-serif;
  ">Verified as to the prescribed office hours.</td>
</tr>
<tr>
  <td colspan="5" style="
    border:none;
    text-align:center;
    font-size:9.5pt;
    font-weight:bold;
    padding:2px 0 0;
    font-family:Arial,sans-serif;
  ">JOSE B. TUASON JR.</td>
</tr>
<tr>
  <td colspan="5" style="border:none;padding:0;text-align:center;">
    <table style="width:80%;margin:0 auto;border-collapse:collapse;">
      <tr>
        <td style="border-top:2pt solid #000;text-align:center;font-size:8.5pt;font-weight:bold;padding:4px 0 2px;font-family:Arial,sans-serif;">
          CHIEF ADMINISTRATIVE OFFICER
        </td>
      </tr>
    </table>
  </td>
</tr>
</table>`;

  const wordHtml = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word"
    xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>DTR – ${monthLabel}</title>
<!--[if gte mso 9]><xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml><![endif]-->
<style>
  @page {
    size: 21cm 29.7cm;
    margin: 10mm 8mm;
  }
  body {
    font-family: Arial, sans-serif;
    font-size: 9pt;
    color: #000;
    margin: 0;
    padding: 0;
  }
  table { border-collapse: collapse; }
</style>
</head>
<body>
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:42%;"/>
    <col style="width:16%;"/>
    <col style="width:42%;"/>
  </colgroup>
  <tr>
    <td style="vertical-align:top;padding:0 4px 0 0;">${makeCopy()}</td>
    <td style="border-left:1px dashed #bbb;padding:0;"></td>
    <td style="vertical-align:top;padding:0 0 0 4px;">${makeCopy()}</td>
  </tr>
</table>
</body>
</html>`;

  const blob = new Blob(["\ufeff", wordHtml], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DTR-${MONTHS[targetMonth]}-${targetYear}-${fullName.replace(/\s+/g, "_") || "trainee"}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
function DashboardPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [rows, setRows] = useState<DtrRow[]>([]);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [profileDirty, setProfileDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);

  // Month/year the user wants to view/download the DTR for. This now also
  // drives which rows are shown in the table below (see visibleRows).
  const [downloadMonth, setDownloadMonth] = useState<number>(new Date().getMonth());
  const [downloadYear, setDownloadYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setUserId(u.user.id);
      setEmail(u.user.email ?? "");

      const [{ data: p }, { data: entries }] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, student_id, company, is_admin")
          .eq("id", u.user.id)
          .maybeSingle(),
        supabase
          .from("dtr_entries")
          .select("id, user_id, entry_date, check_in, break_out, break_in, check_out")
          .eq("user_id", u.user.id)
          .order("entry_date", { ascending: false }),
      ]);

      if (p) setProfile({ ...EMPTY_PROFILE, ...p });
      setRows((entries as DtrRow[] | null) ?? []);
      setLoading(false);
    })();
  }, []);

  const key = todayKey();
  const today: DtrRow = useMemo(
    () =>
      rows.find((r) => r.entry_date === key) ?? {
        entry_date: key,
        check_in: null,
        break_out: null,
        break_in: null,
        check_out: null,
      },
    [rows, key],
  );

  // Strict, manual order — no auto "skip ahead" logic. Whatever hasn't been
  // punched yet, in order, is next.
  const nextPunch: Punch | null = useMemo(() => {
    for (const p of ORDER) {
      if (!today[p]) return p;
    }
    return null;
  }, [today]);

  const punch = async (p: Punch) => {
    if (!userId) return;

    // Check In is only allowed between 8:00 AM and 11:59 AM.
    if (p === "check_in") {
      const h = new Date().getHours();
      if (h < CHECK_IN_START_HOUR || h >= CHECK_IN_END_HOUR) {
        window.alert(
          `Check In is only allowed between ${CHECK_IN_START_HOUR}:00 AM and 11:59 AM.`,
        );
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const updated: DtrRow = { ...today, [p]: nowIso, user_id: userId };
    setRows((prev) => {
      const other = prev.filter((r) => r.entry_date !== key);
      return [updated, ...other];
    });
    const { data, error } = await supabase
      .from("dtr_entries")
      .upsert(
        {
          user_id: userId,
          entry_date: key,
          [p]: nowIso,
          ...(today.id ? { id: today.id } : {}),
        },
        { onConflict: "user_id,entry_date" },
      )
      .select()
      .single();
    if (!error && data) {
      setRows((prev) => {
        const other = prev.filter((r) => r.entry_date !== key);
        return [data as DtrRow, ...other];
      });
    }
  };

  const undoLast = async () => {
    if (!userId || !today.id) return;
    const filled = ORDER.filter((p) => today[p]);
    const last = filled[filled.length - 1];
    if (!last) return;
    const updated = { ...today, [last]: null };
    setRows((prev) =>
      prev.map((r) => (r.entry_date === key ? (updated as DtrRow) : r)),
    );
    await supabase
      .from("dtr_entries")
      .update({ [last]: null } as never)
      .eq("id", today.id);
  };

  const saveProfile = async () => {
    if (!userId) return;
    setSavingProfile(true);
    await supabase.from("profiles").upsert({
      id: userId,
      full_name: profile.full_name,
      student_id: profile.student_id,
      company: profile.company,
    });
    setSavingProfile(false);
    setProfileDirty(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  // Only the rows for the currently selected month/year — this is what the
  // Daily Time Record table on screen renders, so the table always matches
  // whatever month is picked in the dropdown above it.
  const visibleRows = useMemo(
    () => filterRowsByMonth(rows, downloadMonth, downloadYear),
    [rows, downloadMonth, downloadYear],
  );

  const exportCsv = () => {
    const csvRows = [
      ["Date", "Check In", "Break Out", "Break In", "Check Out", "Hours"],
      ...visibleRows.map((r) => [
        r.entry_date,
        fmtTime(r.check_in),
        fmtTime(r.break_out),
        fmtTime(r.break_in),
        fmtTime(r.check_out),
        computeHours(r).toFixed(2),
      ]),
    ];
    const csv = csvRows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dtr-${MONTHS[downloadMonth]}-${downloadYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Trainee's print/download now just delegate to the shared standalone
  // functions defined above the component, passing this trainee's own data.
  // These still receive the FULL `rows` (not visibleRows) since the document
  // builder itself does its own month/year filtering internally.
  const printDtr = () => {
    printDtrFor(profile.full_name || "", rows, downloadMonth, downloadYear);
  };

  const downloadWordDtr = () => {
    downloadWordDtrFor(profile.full_name || "", rows, downloadMonth, downloadYear);
  };

  const totalHours = useMemo(
    () => visibleRows.reduce((s, r) => s + computeHours(r), 0),
    [visibleRows],
  );

  // Build a list of years available for selection, based on existing rows
  // (plus the current year), so the dropdown always has something sensible.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    years.add(new Date().getFullYear());
    for (const r of rows) {
      const y = new Date(r.entry_date + "T00:00:00").getFullYear();
      years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [rows]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              OJT Attendance · {profile.is_admin ? "Admin" : "DTR"}
            </h1>
            <p className="text-xs text-slate-500">
              Signed in as {profile.full_name || email}
              {profile.is_admin && (
                <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Admin
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-2xl font-semibold text-slate-900">
                {now.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
              <div className="text-xs text-slate-500">
                {now.toLocaleDateString(undefined, {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
            <button
              onClick={signOut}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Loading…
          </div>
        ) : profile.is_admin ? (
          <AdminDashboard />
        ) : (
          <>
            {/* Profile */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  Trainee details
                </h2>
                {profileDirty && (
                  <button
                    onClick={saveProfile}
                    disabled={savingProfile}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {savingProfile ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <ProfileField
                  label="Full Name"
                  value={profile.full_name ?? ""}
                  onChange={(v) => {
                    setProfile({ ...profile, full_name: v });
                    setProfileDirty(true);
                  }}
                  placeholder="Juan Dela Cruz"
                />
                <ProfileField
                  label="Student ID"
                  value={profile.student_id ?? ""}
                  onChange={(v) => {
                    setProfile({ ...profile, student_id: v });
                    setProfileDirty(true);
                  }}
                  placeholder="2024-00001"
                />
                <ProfileField
                  label="Host Company"
                  value={profile.company ?? ""}
                  onChange={(v) => {
                    setProfile({ ...profile, company: v });
                    setProfileDirty(true);
                  }}
                  placeholder="Acme Corp."
                />
              </div>
            </section>

            {/* Punch card */}
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Today · {fmtDate(key)}
                </h2>
                <button
                  onClick={undoLast}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Undo last
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                {ORDER.map((p) => {
                  const done = Boolean(today[p]);
                  const isNext = nextPunch === p;
                  return (
                    <div
                      key={p}
                      className={`rounded-lg border p-4 ${
                        done
                          ? "border-emerald-200 bg-emerald-50"
                          : isNext
                            ? "border-slate-300 bg-white"
                            : "border-slate-200 bg-slate-50 opacity-70"
                      }`}
                    >
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {LABELS[p]}
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold text-slate-900">
                        {fmtTime(today[p])}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                {nextPunch ? (
                  <button
                    onClick={() => punch(nextPunch)}
                    disabled={
                      nextPunch === "check_in" &&
                      (now.getHours() < CHECK_IN_START_HOUR ||
                        now.getHours() >= CHECK_IN_END_HOUR)
                    }
                    className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {LABELS[nextPunch]} now
                  </button>
                ) : (
                  <div className="rounded-md bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800">
                    Day complete · {computeHours(today).toFixed(2)} hrs
                  </div>
                )}
                <span className="text-xs text-slate-500">
                  {nextPunch === "check_in" &&
                  (now.getHours() < CHECK_IN_START_HOUR ||
                    now.getHours() >= CHECK_IN_END_HOUR)
                    ? `Check In is only available from ${CHECK_IN_START_HOUR}:00 AM to 11:59 AM.`
                    : "Tap each button yourself — Break Out, Break In, and Check Out are no longer logged automatically."}
                </span>
              </div>
            </section>

            {/* DTR table */}
            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Daily Time Record
                  </h2>
                  <p className="text-xs text-slate-500">
                    {MONTHS[downloadMonth]} {downloadYear} · Total logged:{" "}
                    {totalHours.toFixed(2)} hrs across {visibleRows.length}{" "}
                    day{visibleRows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Month/year picker — now filters the table too, not just downloads */}
                  <select
                    value={downloadMonth}
                    onChange={(e) => setDownloadMonth(Number(e.target.value))}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
                    aria-label="Select month to view/download"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    value={downloadYear}
                    onChange={(e) => setDownloadYear(Number(e.target.value))}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
                    aria-label="Select year to view/download"
                  >
                    {availableYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={exportCsv}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={printDtr}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Print DTR
                  </button>
                  <button
                    onClick={downloadWordDtr}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Download Word
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Check In</th>
                      <th className="px-5 py-3 font-medium">Break Out</th>
                      <th className="px-5 py-3 font-medium">Break In</th>
                      <th className="px-5 py-3 font-medium">Check Out</th>
                      <th className="px-5 py-3 text-right font-medium">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-5 py-10 text-center text-sm text-slate-400"
                        >
                          No records for {MONTHS[downloadMonth]} {downloadYear}.
                        </td>
                      </tr>
                    )}
                    {visibleRows.map((r) => {
                      const h = computeHours(r);
                      return (
                        <tr key={r.entry_date} className="text-slate-700">
                          <td className="px-5 py-3 font-medium text-slate-900">
                            {fmtDate(r.entry_date)}
                          </td>
                          <td className="px-5 py-3 font-mono">
                            {fmtTime(r.check_in)}
                          </td>
                          <td className="px-5 py-3 font-mono">
                            {fmtTime(r.break_out)}
                          </td>
                          <td className="px-5 py-3 font-mono">
                            {fmtTime(r.break_in)}
                          </td>
                          <td className="px-5 py-3 font-mono">
                            {fmtTime(r.check_out)}
                          </td>
                          <td className="px-5 py-3 text-right font-mono">
                            {h ? h.toFixed(2) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function ProfileField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
      />
    </label>
  );
}

// ── Admin Dashboard ──────────────────────────────────────────────────────────
// Shown instead of the trainee punch-in UI when profile.is_admin is true.
// Lets an admin browse every trainee and view/manage their DTR entries.
// Requires RLS SELECT (and optionally UPDATE/DELETE) policies on `profiles`
// and `dtr_entries` that allow rows where the caller's own profile has
// is_admin = true. See setup notes below the component.

type TraineeDtr = DtrRow & { user_id: string };

function AdminDashboard() {
  const [trainees, setTrainees] = useState<TraineeRow[]>([]);
  const [loadingTrainees, setLoadingTrainees] = useState(true);
  const [traineeError, setTraineeError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TraineeDtr[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  // Month/year the admin wants to view/print/download for the selected
  // trainee. This now also drives which rows are shown in the table below.
  const [docMonth, setDocMonth] = useState<number>(new Date().getMonth());
  const [docYear, setDocYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, student_id, company")
        .order("full_name", { ascending: true });
      if (error) {
        setTraineeError(error.message);
      } else {
        setTrainees((data as TraineeRow[]) ?? []);
      }
      setLoadingTrainees(false);
    })();
  }, []);

  const loadEntries = async (userId: string) => {
    setSelectedId(userId);
    setLoadingEntries(true);
    setEntriesError(null);
    const { data, error } = await supabase
      .from("dtr_entries")
      .select("id, user_id, entry_date, check_in, break_out, break_in, check_out")
      .eq("user_id", userId)
      .order("entry_date", { ascending: false });
    if (error) {
      setEntriesError(error.message);
      setEntries([]);
    } else {
      setEntries((data as TraineeDtr[]) ?? []);
    }
    setLoadingEntries(false);
  };

  const deleteEntry = async (entryId: string) => {
    if (!window.confirm("Delete this DTR entry? This cannot be undone.")) return;
    const { error } = await supabase.from("dtr_entries").delete().eq("id", entryId);
    if (!error) {
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } else {
      window.alert(`Failed to delete: ${error.message}`);
    }
  };

  const clearPunch = async (entryId: string, field: Punch) => {
    const { error } = await supabase
      .from("dtr_entries")
      .update({ [field]: null } as never)
      .eq("id", entryId);
    if (!error) {
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, [field]: null } : e)),
      );
    } else {
      window.alert(`Failed to update: ${error.message}`);
    }
  };

  const selectedTrainee = trainees.find((t) => t.id === selectedId);

  const filteredTrainees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trainees;
    return trainees.filter((t) =>
      [t.full_name, t.student_id, t.company]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [trainees, search]);

  // Only the selected trainee's rows for the currently selected month/year —
  // this is what the table below renders, kept in sync with the dropdowns.
  const visibleEntries = useMemo(
    () => filterRowsByMonth(entries, docMonth, docYear),
    [entries, docMonth, docYear],
  );

  const selectedTotalHours = useMemo(
    () => visibleEntries.reduce((s, r) => s + computeHours(r), 0),
    [visibleEntries],
  );

  const exportSelectedCsv = () => {
    if (!selectedTrainee) return;
    const csvRows = [
      ["Date", "Check In", "Break Out", "Break In", "Check Out", "Hours"],
      ...visibleEntries.map((r) => [
        r.entry_date,
        fmtTime(r.check_in),
        fmtTime(r.break_out),
        fmtTime(r.break_in),
        fmtTime(r.check_out),
        computeHours(r).toFixed(2),
      ]),
    ];
    const csv = csvRows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dtr-${(selectedTrainee.full_name || selectedTrainee.id).replace(/\s+/g, "_")}-${MONTHS[docMonth]}-${docYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Years available in the picker, based on the selected trainee's own
  // entries (plus the current year), same approach as the trainee dashboard.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    years.add(new Date().getFullYear());
    for (const r of entries) {
      const y = new Date(r.entry_date + "T00:00:00").getFullYear();
      years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [entries]);

  const printSelectedDtr = () => {
    if (!selectedTrainee) return;
    printDtrFor(selectedTrainee.full_name || "", entries, docMonth, docYear);
  };

  const downloadSelectedWordDtr = () => {
    if (!selectedTrainee) return;
    downloadWordDtrFor(selectedTrainee.full_name || "", entries, docMonth, docYear);
  };

  return (
    <section className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Trainee list */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Trainees {trainees.length > 0 && `(${trainees.length})`}
          </h2>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, ID, company…"
          className="mb-3 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-slate-400"
        />
        {traineeError && (
          <p className="mb-2 text-xs text-red-600">
            Couldn't load trainees: {traineeError}. Check your RLS policy allows admins to
            select all profiles.
          </p>
        )}
        {loadingTrainees ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : filteredTrainees.length === 0 ? (
          <p className="text-xs text-slate-400">No trainees found.</p>
        ) : (
          <ul className="max-h-[70vh] space-y-1 overflow-y-auto">
            {filteredTrainees.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => loadEntries(t.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                    selectedId === t.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <div className="font-medium">{t.full_name || "Unnamed"}</div>
                  <div
                    className={`text-xs ${
                      selectedId === t.id ? "text-slate-300" : "text-slate-400"
                    }`}
                  >
                    {t.student_id || "No ID"} · {t.company || "No company"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Selected trainee's DTR */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {selectedTrainee
                ? `${selectedTrainee.full_name || "Unnamed"}'s DTR`
                : "Select a trainee"}
            </h2>
            {selectedTrainee && (
              <p className="text-xs text-slate-500">
                {selectedTrainee.student_id || "No ID"} ·{" "}
                {selectedTrainee.company || "No company"} · {MONTHS[docMonth]}{" "}
                {docYear} · Total: {selectedTotalHours.toFixed(2)} hrs across{" "}
                {visibleEntries.length} day{visibleEntries.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
          {selectedTrainee && entries.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={docMonth}
                onChange={(e) => setDocMonth(Number(e.target.value))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
                aria-label="Select month to view/print/download"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={docYear}
                onChange={(e) => setDocYear(Number(e.target.value))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
                aria-label="Select year to view/print/download"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button
                onClick={exportSelectedCsv}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Export CSV
              </button>
              <button
                onClick={printSelectedDtr}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Print DTR
              </button>
              <button
                onClick={downloadSelectedWordDtr}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Download Word
              </button>
            </div>
          )}
        </div>

        {!selectedId ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            Pick a trainee from the list to view their records.
          </p>
        ) : entriesError ? (
          <p className="px-5 py-10 text-center text-sm text-red-600">
            Couldn't load entries: {entriesError}. Check your RLS policy allows admins to
            select all dtr_entries.
          </p>
        ) : loadingEntries ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            Loading records…
          </p>
        ) : entries.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            No records for this trainee yet.
          </p>
        ) : visibleEntries.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            No records for {MONTHS[docMonth]} {docYear}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Check In</th>
                  <th className="px-5 py-3 font-medium">Break Out</th>
                  <th className="px-5 py-3 font-medium">Break In</th>
                  <th className="px-5 py-3 font-medium">Check Out</th>
                  <th className="px-5 py-3 text-right font-medium">Hours</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleEntries.map((r) => (
                  <tr key={r.id} className="text-slate-700">
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {fmtDate(r.entry_date)}
                    </td>
                    {ORDER.map((p) => (
                      <td key={p} className="px-5 py-3 font-mono">
                        <div className="flex items-center gap-2">
                          <span>{fmtTime(r[p] as string | null)}</span>
                          {r[p] && (
                            <button
                              onClick={() => clearPunch(r.id!, p)}
                              title={`Clear ${LABELS[p]}`}
                              className="text-[10px] font-medium text-slate-400 hover:text-red-600"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    ))}
                    <td className="px-5 py-3 text-right font-mono">
                      {computeHours(r).toFixed(2)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => deleteEntry(r.id!)}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
