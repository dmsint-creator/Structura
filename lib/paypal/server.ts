import "server-only";

const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
const LIVE_BASE_URL = "https://api-m.paypal.com";

export type PayPalSubscription = {
  id: string;
  plan_id?: string;
  status?: string;
  start_time?: string;
  billing_info?: {
    next_billing_time?: string;
    last_payment?: {
      amount?: {
        currency_code?: string;
        value?: string;
      };
      time?: string;
    };
  };
};

function getConfig() {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const environment = process.env.PAYPAL_ENV || "sandbox";
  const planId = process.env.PAYPAL_PLAN_ID;

  if (!clientId || !clientSecret || !planId) {
    throw new Error(
      "Missing NEXT_PUBLIC_PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET or PAYPAL_PLAN_ID",
    );
  }

  return {
    clientId,
    clientSecret,
    planId,
    baseUrl: environment === "live" ? LIVE_BASE_URL : SANDBOX_BASE_URL,
  };
}

export function getPayPalPublicConfig() {
  const { clientId, planId } = getConfig();
  return { clientId, planId };
}

export async function getPayPalAccessToken() {
  const { clientId, clientSecret, baseUrl } = getConfig();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || "Unable to authenticate with PayPal");
  }

  return data.access_token as string;
}

export async function getPayPalSubscription(subscriptionId: string) {
  const { baseUrl } = getConfig();
  const accessToken = await getPayPalAccessToken();

  const response = await fetch(
    `${baseUrl}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || "Unable to verify PayPal subscription");
  }

  return data as PayPalSubscription;
}

export function expectedPayPalPlanId() {
  return getConfig().planId;
}
