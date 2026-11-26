import { describe, expect, it, vi } from "vitest";
import { getInstallerLinks, INSTALLER_FILES } from "./appDownloads";

const windowsPath = `/installers/${INSTALLER_FILES.windows}`;
const androidPath = `/installers/${INSTALLER_FILES.android}`;
const binary = (type: string) => new Response(null, { headers: { "content-type": type } });
const appRelease = {
  tag_name: "apps-v1.0.0",
  assets: [{ name: INSTALLER_FILES.android, state: "uploaded", size: 1024 }],
};

describe("installer links", () => {
  it("uses the local installers without calling GitHub", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(binary("application/octet-stream"))
      .mockResolvedValueOnce(new Response(null, { headers: { "content-length": "1000" } }));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;

    await expect(getInstallerLinks(signal)).resolves.toEqual({ windows: windowsPath, android: androidPath });
    expect(fetcher.mock.calls).toEqual([
      [windowsPath, { method: "HEAD", signal }],
      [androidPath, { method: "HEAD", signal }],
    ]);
  });

  it("uses a published release when an installer URL returns the SPA shell", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(binary("application/vnd.microsoft.portable-executable"))
      .mockResolvedValueOnce(binary("text/html; charset=utf-8"))
      .mockResolvedValueOnce(Response.json([
        { ...appRelease, tag_name: "v2.0.0" },
        { ...appRelease, tag_name: "apps-v3.0.0", prerelease: true },
        appRelease,
      ])));

    await expect(getInstallerLinks(new AbortController().signal)).resolves.toEqual({
      windows: windowsPath,
      android: `https://github.com/Chernov2312/Spark/releases/download/apps-v1.0.0/${INSTALLER_FILES.android}`,
    });
  });

  it("leaves the links unavailable if both sources fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));

    await expect(getInstallerLinks(new AbortController().signal)).resolves.toEqual({ windows: null, android: null });
  });
});
