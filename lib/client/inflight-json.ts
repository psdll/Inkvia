export type InFlightJsonResponse<T> = {
  ok: boolean;
  json: T | null;
};

const inFlightJsonRequests = new Map<string, Promise<InFlightJsonResponse<unknown>>>();

function requestJson<T>(url: string): Promise<InFlightJsonResponse<T>> {
  return fetch(url, { cache: "no-store" }).then(async (response) => ({
    ok: response.ok,
    json: await response.json().catch(() => null),
  }));
}

export function fetchJsonOnce<T = unknown>(url: string, scope = ""): Promise<InFlightJsonResponse<T>> {
  if (process.env.NODE_ENV === "production") return requestJson<T>(url);

  const requestKey = scope ? `${scope}\u0000${url}` : url;
  const existing = inFlightJsonRequests.get(requestKey);
  if (existing) return existing as Promise<InFlightJsonResponse<T>>;

  let request: Promise<InFlightJsonResponse<unknown>>;
  request = requestJson(url)
    .finally(() => {
      if (inFlightJsonRequests.get(requestKey) === request) inFlightJsonRequests.delete(requestKey);
    });
  inFlightJsonRequests.set(requestKey, request);
  return request as Promise<InFlightJsonResponse<T>>;
}
