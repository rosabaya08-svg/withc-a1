const UPSTREAM_HOST = "smart-signage.pages.dev";

function buildUpstreamUrl(requestUrl) {
  const url = new URL(requestUrl);
  url.protocol = "https:";
  url.hostname = UPSTREAM_HOST;
  return url;
}

function withFreshHeaders(response) {
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") || "";

  if (
    contentType.includes("text/html") ||
    contentType.includes("javascript") ||
    contentType.includes("application/json")
  ) {
    headers.set("cache-control", "no-store, must-revalidate");
  }

  headers.set("x-a4-origin", UPSTREAM_HOST);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request) {
    const upstreamUrl = buildUpstreamUrl(request.url);
    const upstreamRequest = new Request(upstreamUrl, request);
    const response = await fetch(upstreamRequest, {
      cf: {
        cacheTtl: 0,
        cacheEverything: false,
      },
    });

    return withFreshHeaders(response);
  },
};
