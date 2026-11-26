import { expect, test } from "@playwright/test";

test("Spark offers both installers and shows the Safari installation steps", async ({ page }) => {
  await page.route("**/installers/Spark-*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({
      headers: { "content-disposition": `attachment; filename="${name}"` },
      contentType: "application/octet-stream",
      body: route.request().method() === "HEAD" ? undefined : "installer",
    });
  });

  await page.goto("/");
  const downloadPageLink = page.getByRole("link", { name: "Скачать Spark", exact: true });
  await expect(downloadPageLink).toBeVisible();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, { prompt: async () => { document.body.dataset.installRequested = "true"; } });
    window.dispatchEvent(event);
  });
  await downloadPageLink.click();
  await expect(page.getByRole("heading", { name: "Скачать Spark" })).toBeVisible();

  for (const [platform, file] of [["Windows", "Spark-Windows-x64.exe"], ["Android", "Spark-Android.apk"]]) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: `Скачать для ${platform}` }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(file);
    expect(await download.failure()).toBeNull();
  }

  await page.getByText("Как установить", { exact: true }).click();
  await expect(page.getByText("Откройте Spark в Safari", { exact: false })).toBeVisible();
  const install = page.getByRole("button", { name: "Установить веб-приложение" });
  await install.click();
  await expect(page.locator("body")).toHaveAttribute("data-install-requested", "true");
  await expect(install).toHaveCount(0);
});
