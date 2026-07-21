import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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

// ── Civil Service Form No. 48 Print Modal ─────────────────────────────────────
function DtrPrintView({
  rows,
  profile,
  month,
  year,
  onClose,
}: {
  rows: DtrRow[];
  profile: Profile;
  month?: number;
  year?: number;
  onClose: () => void;
}) {
  const now = new Date();
  const targetMonth = month ?? now.getMonth();
  const targetYear = year ?? now.getFullYear();

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

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const rows31: string[] = [];
    for (let day = 1; day <= 31; day++) {
      const row = day <= daysInMonth ? byDay[day] : null;
      const weekend = day <= daysInMonth && isWeekend(day);
      const color = weekend ? "#cc0000" : "#000000";
      const dayLabel = day <= daysInMonth ? String(day) : "";

      const amIn  = row ? hhmm(row.check_in)  : "";
      const amOut = row ? hhmm(row.break_out) : "";
      const pmIn  = row ? hhmm(row.break_in)  : "";
      const pmOut = row ? hhmm(row.check_out) : "";

      rows31.push(`
        <tr>
          <td style="color:${color};text-align:center;font-size:9px;padding:0 2px;width:18px;">${dayLabel}</td>
          <td style="font-size:8px;text-align:center;padding:0 1px;">${amIn}</td>
          <td style="font-size:8px;text-align:center;padding:0 1px;">${amOut}</td>
          <td style="font-size:8px;text-align:center;padding:0 1px;">${pmIn}</td>
          <td style="font-size:8px;text-align:center;padding:0 1px;">${pmOut}</td>
        </tr>
      `);
    }

    const monthLabel = `${MONTHS[targetMonth]} ${targetYear}`;

    const copy = (monthDisplay: string) => `
      <div class="copy">
        <div class="form-no">CIVIL SERVICE FORM NO.48</div>
        <div class="title-wrap"><h1>DAILY TIME RECORD</h1></div>

        <div class="name-block">
          <div class="name-value">${profile.full_name || ""}</div>
        </div>

        <div class="month-line">For the month of: &nbsp;<strong>${monthDisplay}</strong></div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th rowspan="2" style="width:18px;">Day</th>
                <th colspan="2">AM</th>
                <th colspan="2">PM</th>
              </tr>
              <tr>
                <th>Time In</th>
                <th>Time Out</th>
                <th>Time In</th>
                <th>Time Out</th>
              </tr>
            </thead>
            <tbody>
              ${rows31.join("")}
            </tbody>
          </table>
        </div>

        <div class="cert">
          I CERTIFY on my honor that above is a true and correct<br/>
          report of the hours of work performed, record of which was made<br/>
          daily at the time of arrival at and departure from office.
        </div>

        <div class="trainee-sig">
          <div class="sig-name-above">${profile.full_name || ""}</div>
          <div class="sig-line"></div>
        </div>

        <div class="verified">Verified as to the prescribed office hours.</div>

        <div class="supervisor-sig">
          <div class="sup-name">JOSE B. TUASON JR.</div>
          <div class="sig-line"></div>
          <div class="sup-title">CHIEF ADMINISTRATIVE OFFICER</div>
        </div>
      </div>
    `;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>DTR - ${monthLabel}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4 portrait; margin: 8mm 6mm; }
    html, body {
      font-family: Arial, sans-serif;
      font-size: 10px;
      color: #000;
    }

    .page {
      display: flex;
      flex-direction: row;
      width: 100%;
    }

    .copy {
      width: 50%;
      padding: 3mm 4mm;
      border-right: 1.5px dashed #aaa;
    }
    .copy:last-child { border-right: none; }

    /* Form number */
    .form-no { font-size: 8px; margin-bottom: 2px; }

    /* Title */
    .title-wrap {
      border-top: 2.5px double #000;
      border-bottom: 2.5px double #000;
      padding: 3px 0;
      margin-bottom: 4px;
    }
    h1 {
      font-size: 15px;
      font-weight: 900;
      text-align: center;
      letter-spacing: 2px;
    }

    /* Name */
    .name-block { text-align: center; margin-bottom: 3px; }
    .name-value {
      display: inline-block;
      min-width: 170px;
      font-size: 12px;
      font-weight: bold;
      border-bottom: 1px solid #000;
      padding: 0 8px;
      text-align: center;
    }

    /* Month line */
    .month-line { font-size: 9.5px; margin-bottom: 3px; }
    .month-line strong { font-weight: bold; }

    /* Table */
    .table-wrap { margin-bottom: 0; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table, th, td { border: 1px solid #000; }
    th {
      font-size: 8.5px;
      text-align: center;
      padding: 2px 1px;
      font-weight: bold;
    }
    td {
      font-size: 8px;
      text-align: center;
      padding: 0 1px;
      height: 6.8mm;
      vertical-align: middle;
    }

    /* Certification */
    .cert {
      font-size: 9px;
      margin-top: 8px;
      line-height: 1.7;
      text-align: center;
    }

    /* Trainee signature block */
    .trainee-sig {
      margin-top: 10px;
      text-align: center;
    }
    .trainee-sig .sig-name-above {
      font-size: 11px;
      font-weight: bold;
      margin-bottom: 2px;
    }
    .trainee-sig .sig-line {
      border-top: 1.5px solid #000;
      width: 80%;
      margin: 0 auto;
    }

    /* Verified */
    .verified { font-size: 9px; margin-top: 7px; margin-bottom: 7px; }

    /* Supervisor block */
    .supervisor-sig { text-align: center; }
    .supervisor-sig .sup-name {
      font-size: 11px;
      font-weight: bold;
      margin-bottom: 2px;
    }
    .supervisor-sig .sig-line {
      border-top: 1.5px solid #000;
      width: 80%;
      margin: 0 auto 2px;
    }
    .supervisor-sig .sup-title {
      font-size: 10px;
      font-weight: bold;
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="page">
    ${copy(monthLabel)}
    ${copy(monthLabel)}
  </div>
</body>
</html>`;

    iframe.srcdoc = html;

    const handleLoad = () => {
      iframe.contentWindow?.print();
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      {/* Hidden iframe that triggers print */}
      <iframe
        ref={iframeRef}
        style={{ width: 0, height: 0, border: "none", position: "absolute" }}
        title="DTR Print"
      />

      {/* Modal card */}
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 380,
          width: "100%",
          textAlign: "center",
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 40, marginBottom: 10 }}>🖨️</div>
        <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          Civil Service Form No. 48
        </h3>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>
          Daily Time Record for{" "}
          <strong>
            {MONTHS[month ?? new Date().getMonth()]} {year ?? new Date().getFullYear()}
          </strong>
        </p>
        {profile.full_name && (
          <p style={{ fontSize: 12, color: "#475569", marginBottom: 14 }}>
            {profile.full_name}
            {profile.student_id ? ` · ${profile.student_id}` : ""}
          </p>
        )}
        <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 20 }}>
          Your print dialog should have opened automatically.
          <br />If not, click Print below.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button
            onClick={() => iframeRef.current?.contentWindow?.print()}
            style={{
              background: "#0f172a",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 22px",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Print
          </button>
          <button
            onClick={onClose}
            style={{
              background: "#f1f5f9",
              color: "#334155",
              border: "none",
              borderRadius: 8,
              padding: "9px 22px",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
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
  const [showPrint, setShowPrint] = useState(false);

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
                    onClick={() => setShowPrint(true)}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Print DTR
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

      {/* Civil Service Form No. 48 print modal */}
      {showPrint && (
        <DtrPrintView
          rows={rows}
          profile={profile}
          onClose={() => setShowPrint(false)}
        />
      )}
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
