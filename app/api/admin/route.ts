import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../auth-server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

export async function GET(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.account_type !== "admin") {
    return NextResponse.json(
      { error: "Platform admin access required" },
      { status: 403 },
    );
  }

  const admin = createSupabaseAdminClient();

  const [
    clientsResult,
    organizationsResult,
    subscriptionsResult,
    paymentsResult,
    membershipsResult,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, name, status, created_at")
      .eq("account_type", "client")
      .order("created_at", { ascending: false }),
    admin
      .from("organizations")
      .select("id, name, status, created_at")
      .order("created_at", { ascending: false }),
    admin
      .from("subscriptions")
      .select(
        "id, organization_id, provider, paypal_subscription_id, status, amount, currency, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at",
      )
      .order("created_at", { ascending: false }),
    admin
      .from("payment_transactions")
      .select(
        "id, organization_id, subscription_id, provider, provider_transaction_id, amount, currency, status, paid_at, created_at",
      )
      .order("paid_at", { ascending: false, nullsFirst: false })
      .limit(100),
    admin
      .from("organization_members")
      .select("organization_id, user_id, status"),
  ]);

  const firstError =
    clientsResult.error ||
    organizationsResult.error ||
    subscriptionsResult.error ||
    paymentsResult.error ||
    membershipsResult.error;

  if (firstError) {
    console.error("Admin dashboard query failed:", firstError);
    return NextResponse.json(
      { error: "Unable to load admin dashboard" },
      { status: 500 },
    );
  }

  const clients = clientsResult.data ?? [];
  const organizations = organizationsResult.data ?? [];
  const subscriptions = subscriptionsResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const memberships = membershipsResult.data ?? [];

  const orgById = new Map(
    organizations.map((organization) => [organization.id, organization]),
  );
  const subscriptionByOrg = new Map(
    subscriptions.map((subscription) => [
      subscription.organization_id,
      subscription,
    ]),
  );

  const clientIds = new Set(clients.map((client) => client.id));
  const clientOrgIds = new Set(
    memberships
      .filter(
        (membership) =>
          membership.status === "Active" &&
          clientIds.has(membership.user_id),
      )
      .map((membership) => membership.organization_id),
  );

  const completedPayments = payments.filter(
    (payment) => payment.status === "completed",
  );

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  const monthlyRevenue = completedPayments
    .filter(
      (payment) =>
        payment.paid_at &&
        new Date(payment.paid_at).getTime() >= monthStart.getTime(),
    )
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const totalRevenue = completedPayments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0,
  );

  const activeSubscriptions = subscriptions.filter(
    (subscription) => subscription.status === "active",
  ).length;

  const clientRows = [...clientOrgIds]
    .map((organizationId) => {
      const organization = orgById.get(organizationId);
      const subscription = subscriptionByOrg.get(organizationId);

      return {
        organizationId,
        organizationName: organization?.name ?? "Unknown organisation",
        organizationStatus: organization?.status ?? "Unknown",
        subscriptionStatus: subscription?.status ?? "none",
        amount: subscription ? Number(subscription.amount) : 150,
        currency: subscription?.currency ?? "MYR",
        currentPeriodEnd: subscription?.current_period_end ?? null,
        createdAt: organization?.created_at ?? null,
      };
    })
    .sort((a, b) =>
      a.organizationName.localeCompare(b.organizationName),
    );

  const paymentRows = payments.map((payment) => ({
    id: payment.id,
    organizationId: payment.organization_id,
    organizationName:
      orgById.get(payment.organization_id)?.name ?? "Unknown organisation",
    providerTransactionId: payment.provider_transaction_id,
    amount: Number(payment.amount),
    currency: payment.currency,
    status: payment.status,
    paidAt: payment.paid_at,
    createdAt: payment.created_at,
  }));

  return NextResponse.json({
    summary: {
      totalClients: clients.length,
      totalClientOrganizations: clientOrgIds.size,
      activeSubscriptions,
      monthlyRevenue,
      totalRevenue,
      currency: "MYR",
    },
    clients: clientRows,
    payments: paymentRows,
  });
}
