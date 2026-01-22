export async function onRequest(context) {
    const { env } = context;

    // Create a safe list of available bindings/vars
    // We only show the NAMES of the variables, not the values (to protect secrets)
    const availableEnvVars = Object.keys(env);

    // Specific checks
    const checks = {
        hasLicenseKeys: !!env.LICENSE_KEYS,
        hasOrders: !!env.ORDERS,
        hasResendKey: !!env.RESEND_API_KEY,
        hasPaypalClient: !!env.PAYPAL_CLIENT_ID,
        hasAdminPassword: !!env.ADMIN_PASSWORD
    };

    return new Response(JSON.stringify({
        available_variables: availableEnvVars,
        status_checks: checks,
        message: "If 'hasLicenseKeys' or 'hasOrders' is false, you MUST add them in Cloudflare Pages Settings -> Functions -> KV namespace bindings."
    }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
    });
}
