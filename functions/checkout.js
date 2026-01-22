export async function onRequestPost(context) {
    const { request, env } = context;

    // Helper: Parse JSON Array safely
    const parseJsonArray = (value) => {
        if (!value) return [];
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    };

    // Configuration from Environment Variables
    const config = {
        apiKey: env.SELLHUB_API_KEY || "",
        authPrefix: env.SELLHUB_AUTH_PREFIX || "",
        storeUrl: env.SELLHUB_STORE_URL || "https://store.sellhub.cx",
        productId: env.SELLHUB_PRODUCT_ID || "",
        variantId: env.SELLHUB_VARIANT_ID || "",
        variantName: env.SELLHUB_VARIANT_NAME || "Default Variant",
        productName: env.SELLHUB_PRODUCT_NAME || "",
        price: env.SELLHUB_PRICE || "",
        currency: (env.SELLHUB_CURRENCY || "eur").toLowerCase(),
        returnUrl: env.SELLHUB_RETURN_URL || "",
        methodName: env.SELLHUB_METHOD_NAME || "",
        customFieldValues: parseJsonArray(env.SELLHUB_CUSTOM_FIELD_VALUES)
    };

    // Validate Config
    const ensureConfig = () => {
        const missing = [];
        if (!config.apiKey) missing.push("SELLHUB_API_KEY");
        if (!config.productId) missing.push("SELLHUB_PRODUCT_ID");
        if (!config.variantId) missing.push("SELLHUB_VARIANT_ID");
        if (!config.productName) missing.push("SELLHUB_PRODUCT_NAME");
        if (!config.price) missing.push("SELLHUB_PRICE");
        if (!config.methodName) missing.push("SELLHUB_METHOD_NAME");
        if (missing.length) return { ok: false, missing };
        return { ok: true };
    };

    const configCheck = ensureConfig();
    if (!configCheck.ok) {
        return new Response(JSON.stringify({ error: "missing_config", missing: configCheck.missing }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    const normalizeStoreUrl = (url) => url.replace(/\/$/, "");
    const baseCheckoutUrl = `${normalizeStoreUrl(config.storeUrl)}/checkout`;
    const checkoutEndpoint = `${normalizeStoreUrl(config.storeUrl)}/api/checkout`;

    try {
        const body = await request.json();
        const { email, returnUrl, quantity } = body || {};

        if (!email || typeof email !== "string" || !email.includes("@")) {
            return new Response(JSON.stringify({ error: "invalid_email" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        const safeReturnUrl = typeof returnUrl === "string" && /^https?:\/\//i.test(returnUrl) ? returnUrl : config.returnUrl || "https://example.com";
        const parsedQuantity = Number.isFinite(Number(quantity)) ? Math.max(1, Math.min(25, Math.round(Number(quantity)))) : 1;

        const buildPayload = (itemId, itemName, includeDetails = true) => ({
            email,
            currency: config.currency,
            returnUrl: safeReturnUrl,
            methodName: config.methodName,
            customFieldValues: config.customFieldValues,
            cart: {
                items: [
                    includeDetails ? {
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
                    } : {
                        id: itemId,
                        variant: { id: config.variantId },
                        quantity: parsedQuantity
                    }
                ],
                bundles: []
            }
        });

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
                headers,
                body: JSON.stringify(payload)
            });

            const rawText = await response.text();
            let data = null;
            try {
                data = JSON.parse(rawText);
            } catch {
                data = { raw: rawText };
            }
            return { response, data };
        };

        const isCartEmpty = (payload) => typeof payload?.error === "string" && payload.error.toLowerCase().includes("cart is empty");

        const primaryPayload = buildPayload(config.productId, config.productName, true);
        const minimalProductPayload = buildPayload(config.productId, config.productName, false);
        const minimalVariantPayload = buildPayload(config.variantId, config.variantName, false);

        let { response, data } = await attemptCheckout(primaryPayload);

        // Retry Logic
        if (!response.ok && isCartEmpty(data)) ({ response, data } = await attemptCheckout(minimalProductPayload));
        if (!response.ok && isCartEmpty(data)) ({ response, data } = await attemptCheckout(minimalVariantPayload));

        // Retry with Basic Auth fallback if needed
        if (!response.ok && isCartEmpty(data) && !config.authPrefix) {
            ({ response, data } = await attemptCheckout(primaryPayload, "Basic "));
            if (!response.ok && isCartEmpty(data)) ({ response, data } = await attemptCheckout(minimalProductPayload, "Basic "));
            if (!response.ok && isCartEmpty(data)) ({ response, data } = await attemptCheckout(minimalVariantPayload, "Basic "));
        }

        // Retry with No Auth fallback if needed
        if (!response.ok && isCartEmpty(data)) {
            ({ response, data } = await attemptCheckout(primaryPayload, ""));
            if (!response.ok && isCartEmpty(data)) ({ response, data } = await attemptCheckout(minimalProductPayload, ""));
            if (!response.ok && isCartEmpty(data)) ({ response, data } = await attemptCheckout(minimalVariantPayload, ""));
        }

        if (!response.ok && isCartEmpty(data)) {
            ({ response, data } = await attemptCheckout(primaryPayload, null));
            if (!response.ok && isCartEmpty(data)) ({ response, data } = await attemptCheckout(minimalProductPayload, null));
            if (!response.ok && isCartEmpty(data)) ({ response, data } = await attemptCheckout(minimalVariantPayload, null));
        }

        if (!response.ok) {
            return new Response(JSON.stringify({ error: "sellhub_error", details: data }), {
                status: response.status,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        const sessionId = data?.session?.id || data?.id || data?.sessionId;
        const url = data?.url || (sessionId ? `${baseCheckoutUrl}/${sessionId}` : null);

        if (!url) {
            return new Response(JSON.stringify({ error: "missing_session", details: data }), {
                status: 502,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        return new Response(JSON.stringify({ url, sessionId }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: "request_failed", message: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }
}

// Handle OPTIONS for CORS
export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        },
    });
}
