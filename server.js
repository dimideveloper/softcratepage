const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

const parseJsonArray = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const config = {
  apiKey: process.env.SELLHUB_API_KEY || "",
  authPrefix: process.env.SELLHUB_AUTH_PREFIX || "",
  storeUrl: process.env.SELLHUB_STORE_URL || "https://store.sellhub.cx",
  productId: process.env.SELLHUB_PRODUCT_ID || "",
  variantId: process.env.SELLHUB_VARIANT_ID || "",
  variantName: process.env.SELLHUB_VARIANT_NAME || "Default Variant",
  productName: process.env.SELLHUB_PRODUCT_NAME || "",
  price: process.env.SELLHUB_PRICE || "",
  currency: (process.env.SELLHUB_CURRENCY || "eur").toLowerCase(),
  returnUrl: process.env.SELLHUB_RETURN_URL || "",
  methodName: process.env.SELLHUB_METHOD_NAME || "",
  customFieldValues: parseJsonArray(process.env.SELLHUB_CUSTOM_FIELD_VALUES)
};

const normalizeStoreUrl = (url) => url.replace(/\/$/, "");
const baseCheckoutUrl = `${normalizeStoreUrl(config.storeUrl)}/checkout`;
const checkoutEndpoint = `${normalizeStoreUrl(config.storeUrl)}/api/checkout`;

app.use(cors());
app.use(express.json());

const ensureConfig = () => {
  const missing = [];
  if (!config.apiKey) missing.push("SELLHUB_API_KEY");
  if (!config.productId) missing.push("SELLHUB_PRODUCT_ID");
  if (!config.variantId) missing.push("SELLHUB_VARIANT_ID");
  if (!config.productName) missing.push("SELLHUB_PRODUCT_NAME");
  if (!config.price) missing.push("SELLHUB_PRICE");
  if (!config.methodName) missing.push("SELLHUB_METHOD_NAME");
  if (missing.length) {
    return { ok: false, missing };
  }
  return { ok: true };
};

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/sellhub/products", async (req, res) => {
  const configCheck = ensureConfig();
  if (!configCheck.ok) {
    return res.status(500).json({ error: "missing_config", missing: configCheck.missing });
  }

  try {
    const search = new URLSearchParams(req.query).toString();
    const url = `https://dash.sellhub.cx/api/sellhub/products${search ? `?${search}` : ""}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `${config.authPrefix}${config.apiKey}`
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ error: "sellhub_error", details: data });
    }
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: "request_failed", message: error.message });
  }
});

app.get("/api/sellhub/variants", async (req, res) => {
  const configCheck = ensureConfig();
  if (!configCheck.ok) {
    return res.status(500).json({ error: "missing_config", missing: configCheck.missing });
  }

  try {
    const search = new URLSearchParams(req.query).toString();
    const url = `https://dash.sellhub.cx/api/sellhub/products/variants${search ? `?${search}` : ""}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `${config.authPrefix}${config.apiKey}`
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ error: "sellhub_error", details: data });
    }
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: "request_failed", message: error.message });
  }
});

app.post("/api/sellhub/checkout", async (req, res) => {
  const { email, returnUrl, quantity } = req.body || {};
  const configCheck = ensureConfig();

  if (!configCheck.ok) {
    return res.status(500).json({
      error: "missing_config",
      missing: configCheck.missing
    });
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "invalid_email" });
  }

  const safeReturnUrl =
    typeof returnUrl === "string" && /^https?:\/\//i.test(returnUrl)
      ? returnUrl
      : config.returnUrl || "https://example.com";

  const parsedQuantity = Number.isFinite(Number(quantity))
    ? Math.max(1, Math.min(25, Math.round(Number(quantity))))
    : 1;

  const buildPayload = (itemId, itemName, includeDetails = true) => ({
    email,
    currency: config.currency,
    returnUrl: safeReturnUrl,
    methodName: config.methodName,
    customFieldValues: config.customFieldValues,
    cart: {
      items: [
        includeDetails
          ? {
              id: itemId,
              coupon: "",
              name: itemName,
              variant: {
                id: config.variantId,
                name: config.variantName,
                price: config.price
              },
              quantity: parsedQuantity,
              addons: []
            }
          : {
              id: itemId,
              variant: {
                id: config.variantId
              },
              quantity: parsedQuantity
            }
      ],
      bundles: []
    }
  });

  try {
    const attemptCheckout = async (payload, authPrefix = config.authPrefix) => {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json"
      };
      if (authPrefix !== null) {
        headers.Authorization = `${authPrefix}${config.apiKey}`;
      }
      const response = await fetch(checkoutEndpoint, {
        method: "POST",
        headers: {
          ...headers
        },
        body: JSON.stringify(payload)
      });

      const rawText = await response.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch (error) {
        data = { raw: rawText };
      }

      return { response, data };
    };

    const isCartEmpty = (payload) =>
      typeof payload?.error === "string" && payload.error.toLowerCase().includes("cart is empty");

    const primaryPayload = buildPayload(config.productId, config.productName, true);
    const minimalProductPayload = buildPayload(config.productId, config.productName, false);
    const minimalVariantPayload = buildPayload(config.variantId, config.variantName, false);
    let { response, data } = await attemptCheckout(primaryPayload);

    if (!response.ok && isCartEmpty(data)) {
      ({ response, data } = await attemptCheckout(minimalProductPayload));
    }

    if (!response.ok && isCartEmpty(data)) {
      ({ response, data } = await attemptCheckout(minimalVariantPayload));
    }

    if (!response.ok && isCartEmpty(data) && !config.authPrefix) {
      ({ response, data } = await attemptCheckout(primaryPayload, "Basic "));
      if (!response.ok && isCartEmpty(data)) {
        ({ response, data } = await attemptCheckout(minimalProductPayload, "Basic "));
      }
      if (!response.ok && isCartEmpty(data)) {
        ({ response, data } = await attemptCheckout(minimalVariantPayload, "Basic "));
      }
    }

    if (!response.ok && isCartEmpty(data)) {
      ({ response, data } = await attemptCheckout(primaryPayload, ""));
      if (!response.ok && isCartEmpty(data)) {
        ({ response, data } = await attemptCheckout(minimalProductPayload, ""));
      }
      if (!response.ok && isCartEmpty(data)) {
        ({ response, data } = await attemptCheckout(minimalVariantPayload, ""));
      }
    }

    if (!response.ok && isCartEmpty(data)) {
      ({ response, data } = await attemptCheckout(primaryPayload, null));
      if (!response.ok && isCartEmpty(data)) {
        ({ response, data } = await attemptCheckout(minimalProductPayload, null));
      }
      if (!response.ok && isCartEmpty(data)) {
        ({ response, data } = await attemptCheckout(minimalVariantPayload, null));
      }
    }

    if (!response.ok) {
      console.warn("Sellhub error:", response.status, data);
      return res.status(response.status).json({
        error: "sellhub_error",
        details: data
      });
    }

    const sessionId = data?.session?.id || data?.id || data?.sessionId;
    const url = data?.url || (sessionId ? `${baseCheckoutUrl}/${sessionId}` : null);

    if (!url) {
      return res.status(502).json({ error: "missing_session", details: data });
    }

    return res.json({ url, sessionId });
  } catch (error) {
    return res.status(500).json({ error: "request_failed", message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Sellhub backend running on http://localhost:${PORT}`);
});
