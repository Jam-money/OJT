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

const EMPTY_PROFILE: Profile = { full_name: "", student_id: "", company: "" };

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
          .select("full_name, student_id, company")
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

  const nextPunch: Punch | null = useMemo(() => {
    for (const p of ORDER) if (!today[p]) return p;
    return null;
  }, [today]);

  const punch = async (p: Punch) => {
    if (!userId) return;
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

  const exportCsv = () => {
    const csvRows = [
      ["Date", "Check In", "Break Out", "Break In", "Check Out", "Hours"],
      ...rows.map((r) => [
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
    a.download = `dtr-${todayKey()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── DTR HTML builder (shared by print & download) ──────────────────────────
  const buildDtrHtml = () => {
    const target = new Date();
    const targetMonth = target.getMonth();
    const targetYear = target.getFullYear();

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
          <div class="name-value">${profile.full_name || ""}</div>
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
          <div class="sig-name">${profile.full_name || ""}</div>
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

    return { html, monthLabel, targetMonth, targetYear };
  };

  const printDtr = () => {
    const { html } = buildDtrHtml();
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "width:0;height:0;border:none;position:absolute;left:-9999px;top:-9999px;";
    document.body.appendChild(iframe);
    iframe.srcdoc = html;
    iframe.onload = () => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    };
  };

  const downloadWordDtr = () => {
    const target = new Date();
    const targetMonth = target.getMonth();
    const targetYear = target.getFullYear();
    const monthLabel = `${MONTHS[targetMonth]} ${targetYear}`;
    const fullName = profile.full_name || "";

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

  <!-- Title -->
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

  <!-- Name -->
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

  <!-- Month line -->
  <tr>
    <td colspan="5" style="
      font-size:8pt;
      border:none;
      padding:3px 0 4px;
      font-family:Arial,sans-serif;
    ">For the month of: &nbsp;<strong>${monthLabel}</strong></td>
  </tr>

  <!-- AM / PM header row -->
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

  <!-- Time In / Time Out sub-header -->
  <tr>
    ${hdrCell("Time In")}
    ${hdrCell("Time Out")}
    ${hdrCell("Time In")}
    ${hdrCell("Time Out")}
  </tr>

  <!-- 31 day rows -->
  ${rows31}

  <!-- Certification text -->
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

  <!-- Trainee signature line -->
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

  <!-- Verified line -->
  <tr>
    <td colspan="5" style="
      border:none;
      font-size:7.5pt;
      padding:6px 0 16px;
      text-align:center;
      font-family:Arial,sans-serif;
    ">Verified as to the prescribed office hours.</td>
  </tr>

  <!-- Supervisor name -->
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

  <!-- Supervisor signature line + title -->
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
    a.download = `DTR-${MONTHS[targetMonth]}-${targetYear}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalHours = useMemo(
    () => rows.reduce((s, r) => s + computeHours(r), 0),
    [rows],
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              OJT Attendance · DTR
            </h1>
            <p className="text-xs text-slate-500">
              Signed in as {profile.full_name || email}
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

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Loading your DTR…
          </div>
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
                    className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
                  >
                    {LABELS[nextPunch]} now
                  </button>
                ) : (
                  <div className="rounded-md bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800">
                    Day complete · {computeHours(today).toFixed(2)} hrs
                  </div>
                )}
                <span className="text-xs text-slate-500">
                  Saved securely to your account.
                </span>
              </div>
            </section>

            {/* DTR table */}
            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Daily Time Record
                  </h2>
                  <p className="text-xs text-slate-500">
                    Total logged: {totalHours.toFixed(2)} hrs across {rows.length}{" "}
                    day{rows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex gap-2">
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
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-5 py-10 text-center text-sm text-slate-400"
                        >
                          No records yet. Punch in above to start your DTR.
                        </td>
                      </tr>
                    )}
                    {rows.map((r) => {
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