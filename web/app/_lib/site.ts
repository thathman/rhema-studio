export const SITE = {
  name: "Rhema Studio",
  legalName: "Rhema Studio contributors",
  tagline: "Plan. Produce. Present. Together.",
  shortDescription:
    "Local-first church service planning, live Scripture and worship presentation, and broadcast production.",
  description:
    "Rhema Studio helps church teams plan services, present Bible passages and songs, collaborate, and operate live congregation and broadcast graphics with local-first reliability.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://github.com/thathman/rhema-studio",
  locale: "en_US",
  twitterHandle: "",
  founded: "2025",
  category: "ChurchSoftware",
  operatingSystems: ["Windows", "macOS"],
  repo: {
    owner: "thathman",
    name: "rhema-studio",
    url: "https://github.com/thathman/rhema-studio",
    releases: "https://github.com/thathman/rhema-studio/releases",
    latestRelease: "https://github.com/thathman/rhema-studio/releases",
    // Send visitors to this fork's release list until branded and verified
    // platform installers have been published under their final filenames.
    downloadWindows:
      "https://github.com/thathman/rhema-studio/releases",
    // Do not point users to the original upstream's Mac installer.
    downloadMac:
      "https://github.com/thathman/rhema-studio/releases",
    // AppImage runs on any distro without a package manager step, so it is the
    // one-click choice; .deb and .rpm stay on the release page.
    downloadLinux:
      "https://github.com/thathman/rhema-studio/releases",
    discussions: "https://github.com/thathman/rhema-studio/discussions",
    stars: { fallback: 0 },
  },
  socials: {
    github: "https://github.com/thathman/rhema-studio",
    twitter: "",
    linkedin: "",
    email: "",
  },
  stats: {
    languages: "2+",
    translations: "6+",
  },
} as const;

/**
 * Where a Download CTA should point. Until branded binaries have been
 * independently validated and released, go to this fork's release listing,
 * never the original upstream app's installer.
 */
export function downloadHref(platform: string | null | undefined): string {
  switch (platform) {
    case "windows":
      return SITE.repo.downloadWindows;
    case "mac":
      return SITE.repo.downloadMac;
    case "linux":
      return SITE.repo.downloadLinux;
    default:
      return SITE.repo.latestRelease;
  }
}

export async function getGitHubStars(): Promise<number> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(
      `https://api.github.com/repos/${SITE.repo.owner}/${SITE.repo.name}`,
      { headers }
    );
    if (!res.ok) return SITE.repo.stars.fallback;
    const data = (await res.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : SITE.repo.stars.fallback;
  } catch {
    return SITE.repo.stars.fallback;
  }
}
