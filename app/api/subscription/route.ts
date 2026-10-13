import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../auth-server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import {
  expectedPayPalPlanId,
  getPayPalPublicConfig,
  getPayPalSubscription,
} from "../../../lib/paypal/server";

function normalizedStatus(status: string | null | undefined) {
  switch ((status || "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "SUSPENDED":
      return "suspended";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    case "APPROVAL_PENDING":
    case "APPROVED":
    default:
      return "pending";
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.account_type === "admin") {
    return NextResponse.json({
      entitled: true,
      bypass: true,
      accountType: "admin",
      subscription: null,
      paypal: null,
    });
  }

  const admin = createSupabaseAdminClient();

  const { data: subscription, error } = await admin
    .from("subscriptions")
    .select(
      "id, provider, paypal_subscription_id, status, amount, currency, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at",
    )
    .eq("organization_id", session.organization_id)
    .maybeSingle();

  if (error) {
    console.error("Subscription status query failed:", error);
    return NextResponse.json(
      { error: "Unable to load subscription status" },
      { status: 500 },
    );
  }

  const paypal = getPayPalPublicConfig();

  return NextResponse.json({
    entitled: subscription?.status === "active",
    bypass: false,
    accountType: "client",
    subscription: subscription
      ? {
          id: subscription.id,
          provider: subscription.provider,
          paypalSubscriptionId: subscription.paypal_subscription_id,
          status: subscription.status,
          amount: Number(subscription.amount ?? 150),
          currency: subscription.currency || "MYR",
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        }
      : null,
    paypal: {
      clientId: paypal.clientId,
      planId: paypal.planId,
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.account_type !== "client") {
    return NextResponse.json(
      { error: "Admin accounts do not require a subscription" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const subscriptionId =
    typeof body.subscriptionId === "string" ? body.subscriptionId.trim() : "";

  if (!subscriptionId) {
    return NextResponse.json(
      { error: "PayPal subscription ID is required" },
      { status: 400 },
    );
  }

  try {
    const paypalSubscription = await getPayPalSubscription(subscriptionId);
    const expectedPlanId = expectedPayPalPlanId();

    if (paypalSubscription.plan_id !== expectedPlanId) {
      return NextResponse.json(
        { error: "The PayPal subscription is for an unexpected billing plan" },
        { status: 400 },
      );
    }

    const status = normalizedStatus(paypalSubscription.status);
    const admin = createSupabaseAdminClient();

    const { data: existing, error: existingError } = await admin
      .from("subscriptions")
      .select("id, organization_id, paypal_subscription_id")
      .eq("paypal_subscription_id", subscriptionId)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing && existing.organization_id !== session.organization_id) {
      return NextResponse.json(
        { error: "This PayPal subscription is already linked to another organisation" },
        { status: 409 },
      );
    }

    const row = {
      organization_id: session.organization_id,
      provider: "paypal",
      plan_code: null,
      paypal_plan_id: expectedPlanId,
      paypal_subscription_id: subscriptionId,
      status,
      amount: 150.0,
      currency: "MYR",
      current_period_start: paypalSubscription.start_time || null,
      current_period_end:
        paypalSubscription.billing_info?.next_billing_time || null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: saveError } = await admin
      .from("subscriptions")
      .upsert(row, { onConflict: "organization_id" })
      .select(
        "id, paypal_subscription_id, status, amount, currency, current_period_start, current_period_end",
      )
      .single();

    if (saveError) {
      throw saveError;
    }

    return NextResponse.json({
      ok: true,
      entitled: saved.status === "active",
      subscription: {
        id: saved.id,
        paypalSubscriptionId: saved.paypal_subscription_id,
        status: saved.status,
        amount: Number(saved.amount),
        currency: saved.currency,
        currentPeriodStart: saved.current_period_start,
        currentPeriodEnd: saved.current_period_end,
      },
    });
  } catch (error) {
    console.error("PayPal subscription verification failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to verify PayPal subscription",
      },
      { status: 500 },
    );
  }
}
