/**
 * Popup: the only screen the operator uses. Tappable controls, no typed incantations
 * beyond the two values only they have (server URL, access key).
 */

const STATE_LABEL = {
  idle: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  fatal: "Needs attention",
};

const $ = (id) => document.getElementById(id);

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function paintStatus({ status }) {
  const state = status?.state ?? "idle";
  const el = $("status");
  el.className = `status status--${state}`;
  el.textContent = STATE_LABEL[state] ?? state;

  const detail = $("detail");
  const parts = [];
  if (status?.lastError) parts.push(status.lastError);
  if (state === "connected" && status?.sessionId) parts.push(`session ${status.sessionId}`);
  if (state === "connected" && status?.lastConnectedAt) {
    parts.push(`since ${new Date(status.lastConnectedAt).toLocaleTimeString()}`);
  }
  detail.textContent = parts.join(" · ");
  detail.className = `detail${status?.lastError ? " detail--bad" : ""}`;
  $("connect").disabled = state === "connected" || state === "connecting";
  $("disconnect").disabled = state === "idle" && !status?.lastError;
}

function paintConfig({ config }) {
  $("serverUrl").value = config?.serverUrl ?? "";
  $("sessionId").value = config?.sessionId ?? "";
  $("controllerId").value = config?.controllerId ?? "";
  $("accessKey").placeholder = config?.accessKey === "set" ? "•••• saved" : "paste once, stored locally";
  $("accessKey").value = "";
  $("allowedOrigins").value = (config?.allowedOrigins ?? []).join(", ");
}

function readForm() {
  return {
    serverUrl: $("serverUrl").value.trim(),
    sessionId: $("sessionId").value.trim(),
    controllerId: $("controllerId").value.trim(),
    accessKey: $("accessKey").value.trim(),
    allowedOrigins: $("allowedOrigins").value,
  };
}

async function refresh() {
  const reply = await send("status");
  if (!reply?.ok) {
    $("status").textContent = "Extension not ready";
    return;
  }
  paintConfig(reply);
  paintStatus(reply);
}

$("config").addEventListener("submit", async (event) => {
  event.preventDefault();
  const patch = readForm();
  if (!patch.accessKey) delete patch.accessKey; // keep the stored key when the field is blank
  $("detail").textContent = "Connecting…";
  $("detail").className = "detail";
  const reply = await send("connect", { patch });
  if (reply?.ok) {
    await refresh();
  } else {
    $("detail").textContent = reply?.result?.error ?? reply?.error ?? "connect failed";
    $("detail").className = "detail detail--bad";
    await refresh();
  }
});

$("disconnect").addEventListener("click", async () => {
  await send("disconnect");
  await refresh();
});

refresh();
setInterval(refresh, 2000);
