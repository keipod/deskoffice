const baseUrl = process.env.HERMES_API_URL?.replace(/\/$/, "");
const token = process.env.HERMES_API_KEY?.trim();

function headers() {
  const result: Record<string, string> = { accept: "application/json" };
  if (token) result.authorization = `Bearer ${token}`;
  return result;
}

export async function hermesStatus() {
  if (!baseUrl) return { available: false, configured: false, detail: "HERMES_API_URL 미설정" };
  try {
    const response = await fetch(baseUrl + "/v1/capabilities", {
      headers: headers(),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return { available: false, configured: true, detail: `HTTP ${response.status}` };
    return { available: true, configured: true, detail: "connected" };
  } catch (error) {
    return {
      available: false,
      configured: true,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function runHermes(input: string, instructions?: string) {
  if (!baseUrl) throw new Error("hermes_not_configured");
  const response = await fetch(baseUrl + "/v1/runs", {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ input, instructions }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`hermes_http_${response.status}`);
  const payload = (await response.json()) as { run_id?: string };
  if (!payload.run_id) throw new Error("hermes_missing_run_id");
  return { runId: payload.run_id };
}
