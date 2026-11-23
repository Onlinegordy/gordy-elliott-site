import appIdentity from "@/config/app-identity.json";

export async function GET(request: Request) {
  const country = request.headers.get("x-vercel-ip-country") ?? "GB";
  const lookup = new URL("https://itunes.apple.com/lookup");
  lookup.searchParams.set("bundleId", appIdentity.bundleId);
  lookup.searchParams.set("country", /^[A-Z]{2}$/.test(country) ? country : "GB");

  try {
    const response = await fetch(lookup, {
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Lookup unavailable");
    const { results } = await response.json();
    const listing = results.find((app: { bundleId: string }) => app.bundleId === appIdentity.bundleId);
    return Response.json({ version: listing?.version ?? null });
  } catch {
    return new Response(null, { status: 503 });
  }
}
