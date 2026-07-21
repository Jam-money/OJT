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

const EMPTY_PROFILE: Profile = { full_name: "", student_id: "", company: "" };

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
    // optimistic
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
                    onClick={() => window.print()}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Print
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
