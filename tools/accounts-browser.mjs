// Run through tools/browser-slot.sh. This harness uses production Menu/Account components;
// auth/provider responses are isolated browser fixtures, never real provider traffic.
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
const out = resolve(".scratch/accounts");
await mkdir(out, { recursive: true });
const styles = [
  ...(await readFile("index.html", "utf8")).matchAll(
    /<link\b[^>]*rel="stylesheet"[^>]*>/g,
  ),
]
  .map((m) => m[0].replaceAll('href="./', 'href="/'))
  .join("");
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<link rel="stylesheet" href="/src/ui/accounts.css"><style>body{background:#101c23}#ui{position:fixed;inset:0}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body><div id="ui"></div><script type="module">import {Menu} from '/src/menu.js'; window.menu=new Menu(document.querySelector('#ui'),{ui(){},ctx(){return{}},inputDevice(){return'keyboard'}});menu.show('title');window.__accountsReady=true;</script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
      return;
    }
    const file = resolve("." + path);
    if (!file.startsWith(resolve(".") + "/")) throw Error("path");
    const bytes = await readFile(file);
    res.setHeader(
      "Content-Type",
      {
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".png": "image/png",
      }[extname(file)] || "application/octet-stream",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const report = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const value =
        path === "/api/auth/config"
          ? { providers: ["google", "discord", "email"] }
          : path === "/api/auth/session"
            ? { user: null }
            : [];
      await route.fulfill({ json: value });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(
      () => window.__accountsReady && window.menu.accounts.ready,
    );
    assert.deepEqual(await page.evaluate(() => menu.accounts.providers), [
      "google",
      "discord",
      "email",
    ]);
    assert.equal(await page.evaluate(() => menu.accounts.offline), false);
    await page.screenshot({ path: resolve(out, `sign-in-${width}.png`) });
    await page.evaluate(() => {
      const a = menu.accounts;
      a.user = { id: "me", displayName: null, plate: "GR-3842" };
      menu.show("accountName");
    });
    await page.screenshot({ path: resolve(out, `name-pick-${width}.png`) });
    await page.evaluate(() => {
      const a = menu.accounts;
      a.user = { id: "me", displayName: "NIGHTDRIVER", plate: "GR-3842" };
      a.friends = [
        {
          id: "friend",
          sender: "me",
          recipient: "friend",
          state: "accepted",
          display_name: "ELENI",
          plate: "GR-2048",
        },
        {
          id: "new",
          sender: "new",
          recipient: "me",
          state: "pending",
          display_name: "NIKOS",
        },
      ];
      a.presence = { friend: { status: "in-race", map: "riviera" } };
      a.invites = [
        {
          id: "invite",
          display_name: "ELENI",
          lobby: "ABC123",
          expires: Date.now() + 120000,
        },
      ];
      menu.show("account");
    });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: resolve(out, `account-friends-${width}.png`),
    });
    await page.evaluate(async () => {
      const C = await import("/src/ui/components.js");
      C.ui.toast("ELENI INVITED YOU TO A LOBBY · OPEN ACCOUNT", {
        icon: "users-three",
        ms: 15000,
      });
    });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: resolve(out, `incoming-invite-${width}.png`),
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false);
    assert.deepEqual(errors, []);
    report.push({ width, errors, overflow });
    await page.close();
  }
  // Browser navigation exercises the mandatory gate, offline exit, privacy and guest bypass.
  const p = await browser.newPage();
  await p.route("**/api/**", (r) =>
    r.fulfill({ status: 503, json: { error: "offline" } }),
  );
  await p.goto("http://127.0.0.1:" + server.address().port);
  await p.waitForFunction(() => window.__accountsReady && menu.accounts.ready);
  assert.equal(await p.locator("#accounts-offline").count(), 1);
  await p.evaluate(() => menu.show("mode"));
  assert.equal(await p.evaluate(() => menu.screen), "mode");
  await p.goto("http://127.0.0.1:" + server.address().port + "?guest=1");
  await p.waitForFunction(() => window.__accountsReady);
  assert.equal(await p.evaluate(() => menu.screen), "title");
  await p.goto("http://127.0.0.1:" + server.address().port + "?privacy=1");
  await p.waitForFunction(() => window.__accountsReady && menu.accounts.ready);
  assert.equal(await p.evaluate(() => menu.screen), "accountPrivacy");
  await p.close();
  await writeFile(
    resolve(out, "browser-report.json"),
    JSON.stringify(
      {
        screenshots: report,
        offlineDegrade: true,
        guestBypass: true,
        privacyLink: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
