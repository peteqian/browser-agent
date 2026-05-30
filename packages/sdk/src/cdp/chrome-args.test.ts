import { expect, test } from "bun:test";

import { buildChromeArgs } from "./chrome-args";

test("buildChromeArgs keeps stealth defaults by default", () => {
  const args = buildChromeArgs({
    remoteDebuggingPort: 9222,
    userDataDir: "/tmp/profile",
  });

  expect(args).toContain("--disable-blink-features=AutomationControlled");
  expect(args).toContain("--no-first-run");
});

test("buildChromeArgs uses minimal launch args in native fingerprint mode", () => {
  const args = buildChromeArgs({
    remoteDebuggingPort: 9222,
    userDataDir: "/tmp/profile",
    fingerprintMode: "native",
  });

  expect(args[0]).toBe("--remote-debugging-port=9222");
  expect(args[1]).toBe("--user-data-dir=/tmp/profile");
  expect(args).not.toContain("--disable-blink-features=AutomationControlled");
  expect(args).not.toContain("--no-first-run");
});

test("buildChromeArgs still honors explicit caller args in native fingerprint mode", () => {
  const args = buildChromeArgs({
    remoteDebuggingPort: 9222,
    userDataDir: "/tmp/profile",
    fingerprintMode: "native",
    extra: ["--window-size=1200,800"],
  });

  expect(args).toContain("--window-size=1200,800");
  expect(args).not.toContain("--disable-blink-features=AutomationControlled");
});
