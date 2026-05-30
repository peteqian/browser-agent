import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal HTTP server for browser integration tests. Serves a fixed map
 * of path -> HTML string from `127.0.0.1` on a random port so multiple
 * tests can run concurrently. Tests should always call `stop()` in a
 * `finally` block.
 */

export interface FixtureServer {
  url: string;
  stop: () => Promise<void>;
}

export interface FixturePages {
  [path: string]: string;
}

export const DEFAULT_FIXTURES: FixturePages = {
  "/empty": `<!doctype html><meta charset="utf-8"><title>Empty</title>`,
  "/form": `<!doctype html><meta charset="utf-8"><title>Form</title>
    <form id="f">
      <input id="user" name="user" autocomplete="off">
      <input id="pass" name="pass" type="password" autocomplete="off">
      <button type="submit">Submit</button>
    </form>`,
  "/upload": `<!doctype html><meta charset="utf-8"><title>Upload</title>
    <form id="f" enctype="multipart/form-data">
      <input id="file" type="file" style="display:none">
      <button type="button" id="trigger">Choose file</button>
      <span id="picked"></span>
    </form>
    <script>
      const file = document.getElementById('file');
      const picked = document.getElementById('picked');
      file.addEventListener('change', () => {
        picked.textContent = Array.from(file.files).map(f => f.name).join(',');
      });
    </script>`,
  "/auth-newtab": `<!doctype html><meta charset="utf-8"><title>Login</title>
    <a id="oauth" href="/oauth" target="_blank">Continue with OAuth</a>`,
  "/oauth": `<!doctype html><meta charset="utf-8"><title>OAuth</title><h1>OAuth provider</h1>`,
  "/paginated": `<!doctype html><meta charset="utf-8"><title>List</title>
    <ul><li>Alpha</li><li>Beta</li><li>Gamma</li><li>Delta</li></ul>`,
};

let fixturePortCounter = 0;

export async function startFixtureServer(
  pages: FixturePages = DEFAULT_FIXTURES,
): Promise<FixtureServer> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const server = createFixtureHttpServer(pages);
    const port = nextFixturePort();
    try {
      await listen(server, port);
      const address = server.address() as AddressInfo;
      return {
        url: `http://127.0.0.1:${address.port}`,
        stop: () =>
          new Promise((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      };
    } catch (error) {
      await closeServer(server);
      if (!isPortInUse(error)) throw error;
    }
  }
  throw new Error("Could not find a free fixture server port.");
}

function createFixtureHttpServer(pages: FixturePages) {
  return createServer((req, res) => {
    const response = fixtureResponse(pages, req.url ?? "/");
    res.writeHead(response.status, Object.fromEntries(response.headers));
    void response.text().then((body) => res.end(body));
  });
}

export function fixtureResponse(pages: FixturePages, requestUrl: string): Response {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const body = pages[url.pathname];
  if (body === undefined) {
    return new Response("not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function nextFixturePort(): number {
  fixturePortCounter += 1;
  return 30_000 + ((process.pid + fixturePortCounter) % 30_000);
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function isPortInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}
