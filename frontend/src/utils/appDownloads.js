export const INSTALLER_FILES = {
  windows: "Spark-Windows-x64.exe",
  android: "Spark-Android.apk",
};

const REPOSITORY = "Chernov2312/Spark";
const APP_TAG = /^apps-v\d+\.\d+\.\d+$/;
const INSTALLER_TYPE = /^(application\/octet-stream|application\/vnd\.android\.package-archive|application\/vnd\.microsoft\.portable-executable|application\/x-msdownload|application\/x-msdos-program)(?:;|$)/i;

export async function getInstallerLinks(signal) {
  const installers = Object.entries(INSTALLER_FILES);
  const local = await Promise.all(installers.map(async ([platform, file]) => {
    const url = `/installers/${file}`;
    const response = await fetch(url, { method: "HEAD", signal }).catch(() => null);
    const type = response?.headers.get("content-type");
    const isInstaller = type ? INSTALLER_TYPE.test(type) : Number(response?.headers.get("content-length")) > 0;
    return [platform, response?.ok && isInstaller ? url : null];
  }));
  const links = Object.fromEntries(local);
  const missing = installers.filter(([platform]) => !links[platform]);
  if (!missing.length || signal.aborted) return links;

  const releaseRequest = new AbortController();
  const cancelReleaseRequest = () => releaseRequest.abort();
  const timeout = setTimeout(cancelReleaseRequest, 6000);
  signal.addEventListener("abort", cancelReleaseRequest, { once: true });
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=10`, {
      credentials: "omit",
      signal: releaseRequest.signal,
    });
    if (!response.ok) return links;
    const releases = await response.json();
    if (!Array.isArray(releases)) return links;
    const appReleases = releases.filter((release) =>
      APP_TAG.test(release?.tag_name) && !release.draft && !release.prerelease && Array.isArray(release.assets),
    );

    for (const [platform, file] of missing) {
      const release = appReleases.find(({ assets }) => assets.some((asset) =>
        asset?.name === file && asset.state === "uploaded" && asset.size > 0,
      ));
      if (release) links[platform] = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${file}`;
    }
  } catch {
    // Locally served installers are still available when GitHub cannot be reached.
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancelReleaseRequest);
  }
  return links;
}
