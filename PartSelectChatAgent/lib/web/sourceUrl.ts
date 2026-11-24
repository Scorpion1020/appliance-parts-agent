export function isPartSelectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["partselect.com", "www.partselect.com"].includes(url.hostname)
      && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}
