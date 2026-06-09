export function requireApiData<T>(
  result: { data?: T; error?: unknown; response: Response },
  label: string,
) {
  if (result.data !== undefined) {
    return result.data;
  }

  const detail =
    typeof result.error === "object" && result.error !== null
      ? JSON.stringify(result.error)
      : String(result.error ?? result.response.statusText);
  throw new Error(`${label} failed (${result.response.status}): ${detail}`);
}
