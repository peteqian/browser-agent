import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { detectEnv } from "./env";

const CLOUD_VARS = [
  "KUBERNETES_SERVICE_HOST",
  "AWS_LAMBDA_FUNCTION_NAME",
  "GOOGLE_CLOUD_PROJECT",
  "K_SERVICE",
  "VERCEL",
  "FLY_APP_NAME",
  "RAILWAY_ENVIRONMENT",
  "BROWSER_AGENT_ENV",
];

describe("detectEnv", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of CLOUD_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CLOUD_VARS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  test("explicit override wins over everything", () => {
    process.env.KUBERNETES_SERVICE_HOST = "1.2.3.4";
    expect(detectEnv("local")).toBe("local");
    expect(detectEnv("cloud")).toBe("cloud");
  });

  test("'auto' falls back to detection", () => {
    expect(detectEnv("auto")).toBe("local");
    process.env.KUBERNETES_SERVICE_HOST = "1.2.3.4";
    expect(detectEnv("auto")).toBe("cloud");
  });

  test("BROWSER_AGENT_ENV=local forces local even with cloud markers", () => {
    process.env.KUBERNETES_SERVICE_HOST = "1.2.3.4";
    process.env.BROWSER_AGENT_ENV = "local";
    expect(detectEnv()).toBe("local");
  });

  test("BROWSER_AGENT_ENV=cloud forces cloud", () => {
    process.env.BROWSER_AGENT_ENV = "cloud";
    expect(detectEnv()).toBe("cloud");
  });

  test("BROWSER_AGENT_ENV bogus value falls back to detection", () => {
    process.env.BROWSER_AGENT_ENV = "moon";
    expect(detectEnv()).toBe("local");
  });

  test("BROWSER_AGENT_ENV is case-insensitive and trimmed", () => {
    process.env.BROWSER_AGENT_ENV = "  CLOUD  ";
    expect(detectEnv()).toBe("cloud");
  });

  test("defaults to local with no markers", () => {
    expect(detectEnv()).toBe("local");
  });

  test.each([
    ["KUBERNETES_SERVICE_HOST", "1.2.3.4"],
    ["AWS_LAMBDA_FUNCTION_NAME", "fn"],
    ["FLY_APP_NAME", "app"],
    ["RAILWAY_ENVIRONMENT", "production"],
  ])("detects %s as cloud", (key, value) => {
    process.env[key] = value;
    expect(detectEnv()).toBe("cloud");
  });

  test("VERCEL=1 is cloud", () => {
    process.env.VERCEL = "1";
    expect(detectEnv()).toBe("cloud");
  });

  test("Cloud Run requires both GOOGLE_CLOUD_PROJECT and K_SERVICE", () => {
    process.env.GOOGLE_CLOUD_PROJECT = "p";
    expect(detectEnv()).toBe("local");
    process.env.K_SERVICE = "s";
    expect(detectEnv()).toBe("cloud");
  });
});
