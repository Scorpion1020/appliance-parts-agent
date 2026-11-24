const approvedHosts = new Set(["products.geappliances.com", "producthelp.whirlpool.com"]);

export function isKnowledgeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && approvedHosts.has(url.hostname);
  } catch {
    return false;
  }
}
