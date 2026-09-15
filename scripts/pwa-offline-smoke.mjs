import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:4173";

const chromiumCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : null,
  process.platform === "win32"
    ? "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    : null,
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : null,
  process.platform === "linux" ? "/usr/bin/chromium" : null,
  process.platform === "linux" ? "/usr/bin/chromium-browser" : null,
].filter(Boolean);

const executablePath = chromiumCandidates.find((candidate) =>
  existsSync(candidate),
);

if (!executablePath) {
  throw new Error(
    "No supported Chromium/Edge/Chrome executable was found for the PWA smoke test.",
  );
}

const preview = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--outDir",
    "../dist/teacher",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
    "--strictPort",
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
  },
);

const waitForPreview = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(500),
      });

      if (response.ok) return;
    } catch {
      // Wait until the local production preview is ready.
    }

    await delay(250);
  }

  throw new Error("Production PWA preview did not become ready.");
};

try {
  await waitForPreview();

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });

    const page = await context.newPage();

    await page.goto(`${origin}/?step=0`, {
      waitUntil: "networkidle",
    });

    await page.waitForFunction(
      () =>
        "serviceWorker" in navigator &&
        Boolean(navigator.serviceWorker.controller),
      { timeout: 30000 },
    );

    await context.setOffline(true);

    await page.reload({
      waitUntil: "domcontentloaded",
    });

    const expectedText =
      "\u062a\u0641\u0639\u064a\u0644 \u0646\u0633\u062e\u0629 \u0627\u0644\u0645\u0639\u0644\u0645";

    await page
      .getByText(expectedText, { exact: false })
      .waitFor({ timeout: 30000 });

    if (
      await page.evaluate(
        (text) => !document.documentElement.innerText.includes(text),
        expectedText,
      )
    ) {
      throw new Error(
        "Teacher shell did not appear after reloading while offline.",
      );
    }

    console.log(
      "PWA offline shell verified from the production build.",
    );
  } finally {
    await browser.close();
  }
} finally {
  preview.kill("SIGTERM");
}

