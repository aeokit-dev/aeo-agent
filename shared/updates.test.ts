import { describe, expect, it } from "vitest";
import { availableUpdate, isNewerVersion, trustedReleaseUrl } from "./updates";

describe("update checks", () => {
  it("compares stable semantic versions", () => {
    expect(isNewerVersion("0.1.0", "v0.1.1")).toBe(true);
    expect(isNewerVersion("1.4.9", "1.5.0")).toBe(true);
    expect(isNewerVersion("1.5.0", "1.5.0")).toBe(false);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(false);
    expect(isNewerVersion("1.0", "1.0.1")).toBe(false);
  });

  it("accepts only this repository's HTTPS release pages", () => {
    expect(
      trustedReleaseUrl(
        "https://github.com/aeokit-dev/aeo-agent/releases/tag/v0.2.0",
      ),
    ).toBe(true);
    expect(
      trustedReleaseUrl(
        "https://github.com/attacker/aeo-agent/releases/tag/v0.2.0",
      ),
    ).toBe(false);
    expect(trustedReleaseUrl("javascript:alert(1)")).toBe(false);
  });

  it("returns only newer public stable releases", () => {
    const release = {
      tag_name: "v0.2.0",
      html_url: "https://github.com/aeokit-dev/aeo-agent/releases/tag/v0.2.0",
    };
    expect(availableUpdate("0.1.0", release)).toEqual({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      releaseUrl: release.html_url,
    });
    expect(availableUpdate("0.2.0", release)).toBeNull();
    expect(availableUpdate("0.1.0", { ...release, draft: true })).toBeNull();
    expect(
      availableUpdate("0.1.0", { ...release, prerelease: true }),
    ).toBeNull();
  });
});
