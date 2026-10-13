import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filename) {
  const filePath = path.resolve(process.cwd(), filename);

  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env.local");

const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const environment = process.env.PAYPAL_ENV || "sandbox";

if (!clientId || !clientSecret) {
  console.error(
    "Missing NEXT_PUBLIC_PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env.local",
  );
  process.exit(1);
}

if (environment !== "sandbox") {
  console.error(
    "Safety stop: this setup script is intended for PAYPAL_ENV=sandbox only.",
  );
  process.exit(1);
}

const baseUrl = "https://api-m.sandbox.paypal.com";

async function getAccessToken() {
  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`,
  ).toString("base64");

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Unable to authenticate with PayPal.");
    console.error(data);
    process.exit(1);
  }

  return data.access_token;
}

async function paypalPost(endpoint, accessToken, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`PayPal request failed: ${endpoint}`);
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  return data;
}

async function main() {
  console.log("");
  console.log("Structura PayPal Sandbox Setup");
  console.log("==============================");
  console.log("");

  const accessToken = await getAccessToken();

  console.log("✓ Connected to PayPal Sandbox");

  const product = await paypalPost(
    "/v1/catalogs/products",
    accessToken,
    {
      name: "Structura",
      description:
        "Structura corporate group structure management software",
      type: "SERVICE",
      category: "SOFTWARE",
    },
  );

  console.log(`✓ Product created: ${product.id}`);

  const plan = await paypalPost(
    "/v1/billing/plans",
    accessToken,
    {
      product_id: product.id,
      name: "Structura Monthly",
      description: "Structura subscription - RM150 per month",
      status: "ACTIVE",

      billing_cycles: [
        {
          frequency: {
            interval_unit: "MONTH",
            interval_count: 1,
          },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,

          pricing_scheme: {
            fixed_price: {
              value: "150.00",
              currency_code: "MYR",
            },
          },
        },
      ],

      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 1,
      },
    },
  );

  console.log(`✓ Billing plan created: ${plan.id}`);
  console.log(`✓ Plan status: ${plan.status}`);

  console.log("");
  console.log("SUCCESS");
  console.log("=======");
  console.log("");
  console.log(`Product ID: ${product.id}`);
  console.log(`Plan ID:    ${plan.id}`);

  console.log("");
  console.log("Add this line to .env.local:");
  console.log("");
  console.log(`PAYPAL_PLAN_ID=${plan.id}`);
  console.log("");
  console.log("Do not run this script again.");
}

main().catch((error) => {
  console.error("");
  console.error("PayPal setup failed.");
  console.error(error);
  process.exit(1);
});