// E2E tests. Serves the assembled site (_site/ = code + data branch, see tools/assemble_site.sh)
// unless BASE_URL points at a running deployment (e.g. the live GitHub Pages site).
const { defineConfig, devices } = require("@playwright/test");
const PORT = Number(process.env.PORT || 8811);
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}/`;
const chromeLaunch = process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }
  : { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };

module.exports = defineConfig({
  testDir: "tests",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: BASE_URL, serviceWorkers: "allow", trace: "retain-on-failure" },
  projects: [
    { name: "pixel5", use: { ...devices["Pixel 5"], launchOptions: chromeLaunch } },
    /* iPhone: real WebKit in CI; IPHONE_CHROMIUM=1 emulates the iPhone viewport/UA on Chromium where WebKit can't run */
    { name: "iphone", use: process.env.IPHONE_CHROMIUM
      ? { ...devices["iPhone 13"], defaultBrowserType: "chromium", browserName: "chromium", launchOptions: chromeLaunch }
      : { ...devices["iPhone 13"] } },
  ],
  webServer: process.env.BASE_URL ? undefined : {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory _site`,
    url: BASE_URL + "index.html",
    reuseExistingServer: true,
    stdout: "ignore",
    stderr: "ignore",
  },
});
