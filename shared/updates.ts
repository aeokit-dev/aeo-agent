export interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

const versionParts = (value: string) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return match ? match.slice(1).map(Number) : null;
};

export function isNewerVersion(current: string, candidate: string) {
  const currentParts = versionParts(current);
  const candidateParts = versionParts(candidate);
  if (!currentParts || !candidateParts) return false;
  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] !== currentParts[index])
      return candidateParts[index] > currentParts[index];
  }
  return false;
}

export function trustedReleaseUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      /^\/aeokit-dev\/aeo-agent\/releases\/tag\/[^/]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function availableUpdate(
  currentVersion: string,
  release: GitHubRelease,
) {
  if (release.draft || release.prerelease) return null;
  if (
    typeof release.tag_name !== "string" ||
    !trustedReleaseUrl(release.html_url) ||
    !isNewerVersion(currentVersion, release.tag_name)
  )
    return null;
  return {
    currentVersion,
    latestVersion: release.tag_name.replace(/^v/, ""),
    releaseUrl: release.html_url,
  };
}
