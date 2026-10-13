"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CreditCard, LogOut, ShieldCheck } from "lucide-react";

declare global {
  interface Window {
    paypal?: {
      Buttons: (options: any) => {
        render: (selector: string) => Promise<void>;
        close?: () => void;
      };
    };
  }
}

type StatusResponse = {
  entitled: boolean;
  bypass: boolean;
  accountType: "admin" | "client";
  subscription: null | {
    id: string;
    paypalSubscriptionId: string | null;
    status: string;
    amount: number;
    currency: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  paypal: null | {
    clientId: string;
    planId: string;
  };
};

export default function SubscribePage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const rendered = useRef(false);

  async function loadStatus() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/subscription", { cache: "no-store" });

      if (response.status === 401) {
        location.href = "/";
        return;
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to load subscription");
      }

      if (result.bypass || result.entitled) {
        location.href = "/";
        return;
      }

      setStatus(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load subscription",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (!status?.paypal || rendered.current) return;

    const { clientId, planId } = status.paypal;
    const scriptId = "structura-paypal-sdk";

    async function renderButtons() {
      if (!window.paypal || rendered.current) return;

      rendered.current = true;

      await window.paypal
        .Buttons({
          style: {
            layout: "vertical",
            shape: "rect",
            label: "subscribe",
          },

          createSubscription(_data: unknown, actions: any) {
            return actions.subscription.create({
              plan_id: planId,
            });
          },

          async onApprove(data: { subscriptionID?: string }) {
            if (!data.subscriptionID) {
              setError("PayPal did not return a subscription ID.");
              return;
            }

            setMessage("Verifying your subscription with PayPal…");
            setError("");

            const response = await fetch("/api/subscription", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                subscriptionId: data.subscriptionID,
              }),
            });

            const result = await response.json();

            if (!response.ok) {
              setMessage("");
              setError(result.error || "Unable to verify your subscription.");
              return;
            }

            if (result.entitled) {
              setMessage("Subscription activated. Opening Structura…");
              location.href = "/";
              return;
            }

            setMessage(
              "PayPal approved the subscription. We are waiting for activation confirmation.",
            );
            setTimeout(() => void loadStatus(), 2500);
          },

          onCancel() {
            setMessage("PayPal checkout was cancelled. No changes were made.");
          },

          onError(err: unknown) {
            console.error("PayPal button error:", err);
            setError("PayPal checkout could not be started. Please try again.");
          },
        })
        .render("#paypal-button-container");
    }

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (existing) {
      if (window.paypal) void renderButtons();
      else existing.addEventListener("load", () => void renderButtons(), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      "&components=buttons&vault=true&intent=subscription";
    script.async = true;
    script.onload = () => void renderButtons();
    script.onerror = () => setError("Unable to load PayPal checkout.");
    document.head.appendChild(script);
  }, [status]);

  async function logout() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });

    location.href = "/";
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="rounded-2xl border bg-white px-8 py-7 shadow-sm">
          Checking your Structura subscription…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <ShieldCheck className="h-4 w-4" />
              Structura
            </div>
            <h1 className="mt-2 text-3xl font-bold">Activate your subscription</h1>
          </div>


          <div className="flex items-center gap-3">
  <button
    type="button"
    onClick={() => {
      location.href = "/";
    }}
    className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
  >
    ← Back to Structura
  </button>

  <button
    type="button"
    onClick={() => void logout()}
    className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
  >
    <LogOut className="h-4 w-4" />
    Sign out
  </button>
</div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <section className="rounded-2xl border bg-white p-8 shadow-sm">
            <h2 className="text-xl font-bold">Full Structura access</h2>
            <p className="mt-2 text-slate-500">
              One simple monthly subscription for your organisation.
            </p>

            <div className="mt-8 flex items-end gap-2">
              <span className="text-5xl font-bold">RM150</span>
              <span className="pb-1 text-slate-500">/ month</span>
            </div>

            <div className="mt-8 space-y-4">
              {[
                "Corporate structure management",
                "Entities, ownership and governance records",
                "Documents and reporting",
                "Organisation users and access controls",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-emerald-50 p-1">
                    <Check className="h-4 w-4 text-emerald-700" />
                  </div>
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <p className="mt-8 text-sm text-slate-500">
              Billed monthly through PayPal. Sandbox is currently enabled for testing.
            </p>
          </section>

          <section className="rounded-2xl border bg-white p-8 shadow-sm">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
              <CreditCard className="h-6 w-6" />
            </div>

            <h2 className="text-xl font-bold">Subscribe with PayPal</h2>
            <p className="mt-2 text-sm text-slate-500">
              Complete the PayPal approval to activate your organisation.
            </p>

            {status?.subscription ? (
              <div className="mt-5 rounded-lg border bg-slate-50 p-3 text-sm">
                Current status:{" "}
                <strong className="uppercase">{status.subscription.status}</strong>
              </div>
            ) : null}

            {error ? (
              <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            {message ? (
              <div className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-700">
                {message}
              </div>
            ) : null}

            <div className="mt-6" id="paypal-button-container" />

            <p className="mt-5 text-xs leading-5 text-slate-400">
              Structura verifies the returned subscription with PayPal before recording it.
              Webhook verification will be added when the public staging URL is available.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
