
"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";

type Summary = {
  totalClients: number;
  totalClientOrganizations: number;
  activeSubscriptions: number;
  monthlyRevenue: number;
  totalRevenue: number;
  currency: string;
};

type ClientRow = {
  organizationId: string;
  organizationName: string;
  organizationStatus: string;
  subscriptionStatus: string;
  amount: number;
  currency: string;
  currentPeriodEnd: string | null;
  createdAt: string | null;
};

type PaymentRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  providerTransactionId: string | null;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

type DashboardData = {
  summary: Summary;
  clients: ClientRow[];
  payments: PaymentRow[];
};

const money = (value: number, currency = "MYR") =>
  new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);

const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();

  const className =
    normalized === "active" || normalized === "completed"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : normalized === "pending"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : normalized === "none"
          ? "bg-slate-50 text-slate-600 border-slate-200"
          : "bg-rose-50 text-rose-700 border-rose-200";

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${className}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}

export default function AdminPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const [authState, setAuthState] = useState<
    "checking" | "logged-out" | "client" | "admin"
  >("checking");

  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });

  const requestId = useRef(0);

  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) =>
      setTimeout(resolve, milliseconds)
    );

  async function loadDashboard() {
    const currentRequest = ++requestId.current;

    setLoading(true);
    setError("");

    const delays = [0, 300, 700, 1200];

    try {
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) {
          await wait(delays[attempt]);
        }

        if (currentRequest !== requestId.current) {
          return;
        }

        let response: Response;

        try {
          response = await fetch("/api/admin", {
            cache: "no-store",
            credentials: "same-origin",
          });
        } catch {
          if (attempt < delays.length - 1) {
            continue;
          }

          throw new Error(
            "Unable to connect to the admin dashboard."
          );
        }

        const result = await response
          .json()
          .catch(() => ({}));

        if (currentRequest !== requestId.current) {
          return;
        }

        if (response.status === 401) {
          if (attempt < delays.length - 1) {
            continue;
          }

          setAuthState("logged-out");
          setData(null);
          return;
        }

        if (response.status === 403) {
          setAuthState("client");
          setData(null);
          return;
        }

        if (!response.ok) {
          if (
            response.status >= 500 &&
            attempt < delays.length - 1
          ) {
            continue;
          }

          setError(
            result.error || "Unable to load admin dashboard."
          );

          setData(null);
          return;
        }

        setAuthState("admin");
        setData(result);
        return;
      }
    } catch (caught) {
      if (currentRequest !== requestId.current) {
        return;
      }

      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load admin dashboard."
      );

      setData(null);
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadDashboard();

    return () => {
      requestId.current++;
    };
  }, []);

  async function adminLogin(event: React.FormEvent) {
    event.preventDefault();

    setLoginBusy(true);
    setLoginError("");

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "login",
          email: loginForm.email,
          password: loginForm.password,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setLoginError(
          result.error || "Unable to sign in."
        );
        return;
      }

      if (result.user?.accountType !== "admin") {
        await fetch("/api/auth", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            action: "logout",
          }),
        });

        setLoginError(
          "This account does not have Structura Admin access."
        );

        return;
      }

      setAuthState("admin");

      await loadDashboard();
    } catch {
      setLoginError(
        "Unable to sign in. Please try again."
      );
    } finally {
      setLoginBusy(false);
    }
  }

  async function adminLogout() {
    requestId.current++;

    await fetch("/api/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "logout",
      }),
    });

    setData(null);
    setLoading(false);
    setError("");

    setLoginForm({
      email: "",
      password: "",
    });

    setAuthState("logged-out");
  }

  if (loading && authState === "checking") {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-3xl rounded-2xl border bg-white p-8 shadow-sm">
          Loading Structura Admin…
        </div>
      </main>
    );
  }

  if (authState === "logged-out") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
          <div className="mb-6">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
              <ShieldCheck className="h-6 w-6" />
            </div>

            <h1 className="text-2xl font-bold text-slate-900">
              Structura Admin
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Sign in with an authorised administrator account.
            </p>
          </div>

          <form onSubmit={adminLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Email
              </label>

              <input
                type="email"
                autoComplete="email"
                required
                value={loginForm.email}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-900"
                placeholder="admin@example.com"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Password
              </label>

              <input
                type="password"
                autoComplete="current-password"
                required
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-900"
                placeholder="Enter your password"
              />
            </div>

            {loginError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                {loginError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loginBusy}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loginBusy ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <a
            href="/"
            className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            Back to Structura
          </a>
        </div>
      </main>
    );
  }

  if (authState === "client") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
          <ShieldCheck className="mb-4 h-10 w-10 text-slate-900" />

          <h1 className="text-2xl font-bold text-slate-900">
            Structura Admin
          </h1>

          <p className="mt-3 text-slate-600">
            This account does not have Structura Admin access.
          </p>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => void adminLogout()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Admin Sign In
            </button>

            <a
              href="/"
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Back to Structura
            </a>
          </div>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-3xl rounded-2xl border bg-white p-8 shadow-sm">
          <ShieldCheck className="mb-4 h-10 w-10" />

          <h1 className="text-2xl font-bold text-slate-900">
            Structura Admin
          </h1>

          <p className="mt-3 text-slate-600">
            {error || "Unable to load admin dashboard."}
          </p>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => void loadDashboard()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Try again
            </button>

            <button
              onClick={() => void adminLogout()}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  const cards = [
    {
      label: "Clients",
      value: data.summary.totalClients.toLocaleString(),
      icon: Users,
    },
    {
      label: "Client organisations",
      value:
        data.summary.totalClientOrganizations.toLocaleString(),
      icon: Building2,
    },
    {
      label: "Active subscriptions",
      value:
        data.summary.activeSubscriptions.toLocaleString(),
      icon: CreditCard,
    },
    {
      label: "Revenue this month",
      value: money(
        data.summary.monthlyRevenue,
        data.summary.currency
      ),
      icon: WalletCards,
    },
    {
      label: "Total revenue",
      value: money(
        data.summary.totalRevenue,
        data.summary.currency
      ),
      icon: WalletCards,
    },
  ];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl p-6 lg:p-10">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-500">
              <ShieldCheck className="h-4 w-4" />
              Platform administration
            </div>

            <h1 className="text-3xl font-bold tracking-tight">
              Structura Admin
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Clients, subscriptions and recorded PayPal revenue.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void loadDashboard()}
              className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold shadow-sm"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>

            <a
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold"
            >
              <ArrowLeft className="h-4 w-4" />
              Structura
            </a>

            <button
              onClick={() => void adminLogout()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Sign out
            </button>
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-2xl border bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">
                  {label}
                </p>

                <Icon className="h-5 w-5 text-slate-400" />
              </div>

              <p className="mt-4 text-2xl font-bold">
                {value}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-6 py-5">
            <h2 className="text-lg font-bold">Clients</h2>

            <p className="mt-1 text-sm text-slate-500">
              Subscription status by client organisation.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3">Organisation</th>
                  <th className="px-6 py-3">Organisation status</th>
                  <th className="px-6 py-3">Subscription</th>
                  <th className="px-6 py-3">Monthly fee</th>
                  <th className="px-6 py-3">Period ends</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {data.clients.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-10 text-center text-slate-500"
                    >
                      No client organisations yet.
                    </td>
                  </tr>
                ) : (
                  data.clients.map((client) => (
                    <tr key={client.organizationId}>
                      <td className="px-6 py-4 font-semibold">
                        {client.organizationName}
                      </td>

                      <td className="px-6 py-4">
                        <StatusBadge
                          value={client.organizationStatus}
                        />
                      </td>

                      <td className="px-6 py-4">
                        <StatusBadge
                          value={client.subscriptionStatus}
                        />
                      </td>

                      <td className="px-6 py-4">
                        {money(client.amount, client.currency)}
                      </td>

                      <td className="px-6 py-4 text-slate-600">
                        {date(client.currentPeriodEnd)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-6 py-5">
            <h2 className="text-lg font-bold">
              Recent payments
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Revenue is calculated only from completed payment transactions.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3">Organisation</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Transaction</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {data.payments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-10 text-center text-slate-500"
                    >
                      No payments recorded yet. PayPal transactions
                      will appear here after the payment integration
                      is connected.
                    </td>
                  </tr>
                ) : (
                  data.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-6 py-4 font-semibold">
                        {payment.organizationName}
                      </td>

                      <td className="px-6 py-4 text-slate-600">
                        {date(
                          payment.paidAt || payment.createdAt
                        )}
                      </td>

                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {payment.providerTransactionId || "—"}
                      </td>

                      <td className="px-6 py-4">
                        <StatusBadge value={payment.status} />
                      </td>

                      <td className="px-6 py-4 text-right font-semibold">
                        {money(
                          payment.amount,
                          payment.currency
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
