export async function onRequest(context) {
    return new Response(JSON.stringify({ ok: true }), {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*", // Allow CORS
        },
    });
}
