export async function onRequest(context) {
    const { env, request } = context;
    const config = {
        apiKey: env.SELLHUB_API_KEY || "",
        authPrefix: env.SELLHUB_AUTH_PREFIX || "",
    };

    if (!config.apiKey) {
        return new Response(JSON.stringify({ error: "missing_config", missing: ["SELLHUB_API_KEY"] }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    try {
        const url = new URL(request.url);
        const search = url.searchParams.toString();
        const targetUrl = `https://dash.sellhub.cx/api/sellhub/products/variants${search ? `?${search}` : ""}`;

        const response = await fetch(targetUrl, {
            headers: {
                Authorization: `${config.authPrefix}${config.apiKey}`
            }
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return new Response(JSON.stringify({ error: "sellhub_error", details: data }), {
                status: response.status,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        return new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: "request_failed", message: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }
}
