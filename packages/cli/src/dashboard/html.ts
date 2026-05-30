export function dashboardHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>browser-agent dashboard</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #161616; }
    button, input, textarea { font: inherit; }
    .grid { display: grid; grid-template-columns: 320px 1fr; gap: 20px; align-items: start; }
    .detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    pre { white-space: pre-wrap; border: 1px solid #ddd; padding: 12px; max-height: 70vh; overflow: auto; }
    li { margin: 8px 0; }
    .session-row { display: grid; gap: 4px; }
    .session-actions { display: flex; gap: 8px; }
    .session-meta { color: #555; overflow-wrap: anywhere; }
    #action { display: flex; gap: 8px; align-items: start; margin: 12px 0; }
    #action input { width: 120px; }
    #action textarea { min-height: 64px; flex: 1; }
  </style>
</head>
<body>
  <h1>browser-agent dashboard</h1>
  <form id="launch">
    <input name="profile" placeholder="profile" />
    <input name="cdpUrl" placeholder="http://127.0.0.1:9222" />
    <input name="startUrl" placeholder="https://example.com" />
    <select name="fingerprintMode">
      <option value="stealth">stealth</option>
      <option value="native">native</option>
    </select>
    <label><input name="headless" type="checkbox" checked /> headless</label>
    <button>Launch</button>
  </form>
  <div class="grid">
    <section><h2>Sessions</h2><ul id="sessions"></ul></section>
    <section>
      <h2 id="active">No session selected</h2>
      <form id="action">
        <input name="name" placeholder="click" />
        <textarea name="params" placeholder='{"ref":"@e1"}'></textarea>
        <button>Run</button>
      </form>
      <div class="detail-grid">
        <section><h3>Snapshot</h3><pre id="snapshot"></pre></section>
        <section><h3>Events</h3><pre id="events"></pre></section>
        <section><h3>Artifacts</h3><pre id="artifacts"></pre></section>
      </div>
    </section>
  </div>
  <script>
    const sessions = document.querySelector("#sessions");
    const active = document.querySelector("#active");
    const snapshot = document.querySelector("#snapshot");
    const events = document.querySelector("#events");
    const artifacts = document.querySelector("#artifacts");
    let activeSessionId = "";
    async function loadSessions() {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      sessions.replaceChildren(...data.sessions.map(renderSession));
    }
    function renderSession(session) {
      const item = document.createElement("li");
      item.className = "session-row";
      const actions = document.createElement("div");
      actions.className = "session-actions";
      const open = document.createElement("button");
      open.type = "button";
      open.dataset.action = "events";
      open.dataset.id = session.sessionId;
      open.textContent = session.sessionId;
      const close = document.createElement("button");
      close.type = "button";
      close.dataset.action = "close";
      close.dataset.id = session.sessionId;
      close.textContent = "Close";
      actions.append(open, close);
      const meta = document.createElement("div");
      meta.className = "session-meta";
      meta.textContent = [session.profile, session.url].filter(Boolean).join(" ");
      const count = document.createElement("div");
      count.textContent = "events: " + session.eventCount + " artifacts: " + session.artifactCount;
      item.append(actions, meta, count);
      return item;
    }
    sessions.addEventListener("click", async (event) => {
      const id = event.target?.dataset?.id;
      if (!id) return;
      if (event.target.dataset.action === "close") {
        await fetch("/api/sessions/" + id, { method: "DELETE" });
        if (activeSessionId === id) setActiveSession("");
        events.textContent = "";
        artifacts.textContent = "";
        await loadSessions();
        return;
      }
      await selectSession(id);
    });
    async function selectSession(id) {
      setActiveSession(id);
      await Promise.all([loadSnapshot(id), loadEvents(id), loadArtifacts(id)]);
    }
    function setActiveSession(id) {
      activeSessionId = id;
      active.textContent = id ? "Session " + id : "No session selected";
      if (!id) {
        snapshot.textContent = "";
        events.textContent = "";
        artifacts.textContent = "";
      }
    }
    async function loadSnapshot(id) {
      const res = await fetch("/api/sessions/" + id + "/snapshot");
      const data = await res.json();
      snapshot.textContent = data.observation || JSON.stringify(data, null, 2);
    }
    async function loadEvents(id) {
      const res = await fetch("/api/sessions/" + id + "/events");
      events.textContent = JSON.stringify(await res.json(), null, 2);
    }
    async function loadArtifacts(id) {
      const res = await fetch("/api/sessions/" + id + "/artifacts");
      artifacts.textContent = JSON.stringify(await res.json(), null, 2);
    }
    async function refreshActiveSession() {
      if (!activeSessionId) return;
      await Promise.all([
        loadSnapshot(activeSessionId),
        loadEvents(activeSessionId),
        loadArtifacts(activeSessionId)
      ]);
    }
    document.querySelector("#action").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        if (!activeSessionId) return;
        const form = new FormData(event.target);
        const name = String(form.get("name") || "").trim();
        if (!name) return;
        const paramsText = String(form.get("params") || "{}").trim() || "{}";
        const params = JSON.parse(paramsText);
        const res = await fetch("/api/sessions/" + activeSessionId + "/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, params })
        });
        snapshot.textContent = JSON.stringify(await res.json(), null, 2);
        await loadSessions();
        await refreshActiveSession();
      } catch (error) {
        snapshot.textContent = String(error?.message || error);
      }
    });
    document.querySelector("#launch").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: form.get("profile") || undefined,
          cdpUrl: form.get("cdpUrl") || undefined,
          startUrl: form.get("startUrl") || undefined,
          fingerprintMode: form.get("fingerprintMode") || "stealth",
          headless: form.get("headless") === "on"
        })
      });
      const created = await res.json();
      await loadSessions();
      if (created.sessionId) await selectSession(created.sessionId);
    });
    new EventSource("/api/events").addEventListener("session_event", async () => {
      await loadSessions();
      await refreshActiveSession();
    });
    loadSessions();
  </script>
</body>
</html>`;
}
