export const UPDATE_STATE_KEY = "updateState";
export const RELEASES_URL = "https://github.com/haohaomin/byrdocs-wiki-print/releases/latest";
export const DOWNLOAD_URL = `${RELEASES_URL}/download/byrdocs-wiki-print.zip`;
export const RELEASE_API_URL = "https://api.github.com/repos/haohaomin/byrdocs-wiki-print/releases/latest";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RETRY_INTERVAL_MS = 60 * 60 * 1000;
export const MANUAL_INTERVAL_MS = 60 * 1000;

export interface UpdateState {
  checkedAt?: number;
  attemptedAt?: number;
  latestVersion?: string;
  hasDownload?: boolean;
  error?: string;
}

export function parseVersion(value: unknown): number[] | null {
  if (typeof value !== "string" || !/^v?\d+\.\d+\.\d+(?:\.\d+)?$/i.test(value)) return null;
  const parts = value.replace(/^v/i, "").split(".").map(Number);
  return parts.every(part => Number.isSafeInteger(part) && part <= 65535) ? parts : null;
}

export function isNewerVersion(latest: unknown, current: unknown): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 4; i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference > 0;
  }
  return false;
}

export function parseRelease(value: unknown): Pick<UpdateState, "latestVersion" | "hasDownload"> {
  if (!value || typeof value !== "object") throw new Error("Invalid release");
  const release = value as Record<string, unknown>;
  if (release.draft === true || release.prerelease === true || !parseVersion(release.tag_name)) {
    throw new Error("Invalid release version");
  }
  return {
    latestVersion: (release.tag_name as string).replace(/^v/i, ""),
    hasDownload: Array.isArray(release.assets) && release.assets.some(asset =>
      asset && asset.name === "byrdocs-wiki-print.zip" && asset.state === "uploaded"),
  };
}

/** Public release redirect still works when GitHub's anonymous API quota is exhausted. */
export async function fetchLatestRelease(fetcher: typeof fetch = fetch): Promise<unknown> {
  try {
    const response = await fetcher(RELEASE_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const release: unknown = await response.json();
    parseRelease(release);
    return release;
  } catch {
    const response = await fetcher(RELEASES_URL, {
      method: "HEAD", credentials: "omit", cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const url = new URL(response.url);
    const prefix = "/haohaomin/byrdocs-wiki-print/releases/tag/";
    if (!response.ok || url.origin !== "https://github.com" || !url.pathname.startsWith(prefix)) {
      throw new Error("Unable to resolve latest release");
    }
    const release = { tag_name: decodeURIComponent(url.pathname.slice(prefix.length)), assets: [] };
    parseRelease(release);
    // HEAD cannot confirm assets: link to the release page instead of guessing a ZIP.
    return release;
  }
}

interface CheckerDependencies {
  read: () => Promise<UpdateState>;
  write: (state: UpdateState) => Promise<void>;
  fetchRelease: () => Promise<unknown>;
  now: () => number;
}

/** Shared requests and persisted throttling prevent every tab from hitting GitHub. */
export function createUpdateChecker(deps: CheckerDependencies): (force?: boolean) => Promise<UpdateState> {
  let pending: Promise<UpdateState> | null = null;
  const run = async (force: boolean): Promise<UpdateState> => {
    const previous = await deps.read();
    const now = deps.now();
    const interval = force ? MANUAL_INTERVAL_MS : previous.error ? RETRY_INTERVAL_MS : CHECK_INTERVAL_MS;
    const elapsed = now - (previous.attemptedAt ?? 0);
    if (previous.attemptedAt && elapsed >= 0 && elapsed < interval) return previous;
    // Persist before fetching so service-worker restarts also honor the throttle.
    await deps.write({ ...previous, attemptedAt: now });
    let next: UpdateState;
    try {
      next = { ...parseRelease(await deps.fetchRelease()), attemptedAt: now, checkedAt: deps.now() };
    } catch {
      next = {
        ...previous, attemptedAt: now,
        error: "暂时无法检查更新，请检查网络或稍后重试。",
      };
    }
    await deps.write(next);
    return next;
  };
  return (force = false) => {
    if (!pending) pending = run(force).finally(() => { pending = null; });
    return pending;
  };
}
