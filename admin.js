// /Capstone/admin.js
"use strict";

const $ = (id) => document.getElementById(id);

function safeText(v) {
  return String(v ?? "").trim();
}

function setText(id, msg) {
  const el = $(id);
  if (el) el.textContent = msg ?? "";
}

function setValue(id, val) {
  const el = $(id);
  if (el) el.value = val ?? "";
}

function getValue(id) {
  const el = $(id);
  return el ? el.value : "";
}

function setDisabled(id, disabled) {
  const el = $(id);
  if (el) el.disabled = !!disabled;
}

/** ---------------------------
 *  USERS: UI + API
 *  --------------------------- */
let users = [];

function setUsersStatus(msg) {
  setText("usersStatus", msg || "");
}

function renderUsers() {
  const host = $("usersList");
  if (!host) return;

  host.innerHTML = "";

  if (!users.length) {
    host.innerHTML = `<div class="hint">No users yet.</div>`;
    return;
  }

  users.forEach((u) => host.appendChild(userRow(u)));
}

function userRow(u) {
  const card = document.createElement("div");
  card.style.border = "1px solid var(--line)";
  card.style.borderRadius = "12px";
  card.style.padding = "12px";
  card.style.marginBottom = "10px";
  card.style.background = "#fff";

  const status = u.active ? "Active" : "Deactivated";
  const lock = u.locked ? "Locked" : "OK";
  const needsPw = u.must_set_password ? "Needs password set" : "Password set";

  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <div>
        <div style="font-weight:800;">${u.name || "—"}</div>
        <div class="hint">${u.email || "—"}</div>
        <div class="hint">Status: <b>${status}</b> • ${lock} • ${needsPw}</div>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <button class="btn ghost" type="button" data-setup="${u.user_id}">Send Setup</button>
        <button class="btn ghost" type="button" data-reset="${u.user_id}">Send Reset</button>
        <button class="btn ghost" type="button" data-toggle="${u.user_id}">
          ${u.active ? "Deactivate" : "Activate"}
        </button>
      </div>
    </div>
  `;

  card.querySelector(`[data-setup="${u.user_id}"]`)
    ?.addEventListener("click", () => sendLink(u.user_id, "setup"));

  card.querySelector(`[data-reset="${u.user_id}"]`)
    ?.addEventListener("click", () => sendLink(u.user_id, "reset"));

  card.querySelector(`[data-toggle="${u.user_id}"]`)
    ?.addEventListener("click", () => toggleActive(u.user_id));

  return card;
}

async function refreshUsers() {
  try {
    setUsersStatus("Loading users…");

    const res = await fetch("/api/admin/users", {
      credentials: "include",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load users");

    users = Array.isArray(data.users) ? data.users : [];
    renderUsers();

    // ✅ keep dropdown selection + reload buyer basics if selection still valid
    const previousSelected = getValue("selectedUser");
    populateUserSelect(previousSelected);

    setUsersStatus(`${users.length} user(s) loaded.`);
  } catch (e) {
    setUsersStatus(e.message || "Failed to load users. Is the backend running?");
  }
}

async function createUser() {
  const name = safeText(getValue("newUserName"));
  const email = safeText(getValue("newUserEmail")).toLowerCase();

  if (!name || !email) {
    setUsersStatus("Enter both name and email.");
    return;
  }

  if (!email.includes("@") || !email.includes(".")) {
    setUsersStatus("Enter a valid email address.");
    return;
  }

  try {
    setUsersStatus("Creating user + sending setup link…");

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Create user failed");

    setValue("newUserName", "");
    setValue("newUserEmail", "");

    setUsersStatus(data.link ? `User created. DEV setup link: ${data.link}` : "User created. Setup link sent.");
    await refreshUsers();
  } catch (e) {
    setUsersStatus(e.message || "Create failed");
  }
}


async function sendLink(userId, type) {
  if (!userId) return;

  try {
    setUsersStatus(`Sending ${type} link…`);

    const res = await fetch("/api/admin/users/send-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ user_id: userId, type }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Send link failed");

    if (data.link) setUsersStatus(`DEV ${type} link: ${data.link}`);
    else setUsersStatus(`${type} link sent.`);
  } catch (e) {
    setUsersStatus(e.message || "Failed to send link");
  }
}

async function toggleActive(userId) {
  if (!userId) return;

  try {
    const u = users.find((x) => x.user_id === userId);
    if (u?.active) {
      const ok = confirm(`Deactivate ${u.name}? They won’t be able to log in.`);
      if (!ok) return;
    }

    setUsersStatus("Updating user status…");

    const res = await fetch("/api/admin/users/toggle-active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ user_id: userId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Update failed");

    setUsersStatus("Updated.");
    await refreshUsers();
  } catch (e) {
    setUsersStatus(e.message || "Failed to update user");
  }
}

/** ---------------------------
 *  BUYER BASICS: UI + API
 *  --------------------------- */
function setBuyerBasicsStatus(msg) {
  setText("buyerBasicsStatus", msg || "");
}

function populateUserSelect(keepUserId = "") {
  const sel = $("selectedUser");
  if (!sel) return;

  sel.innerHTML = `<option value="">Select…</option>`;

  users.forEach((u) => {
    const opt = document.createElement("option");
    opt.value = u.user_id;
    opt.textContent = `${u.name || "—"} (${u.email || "—"})`;
    sel.appendChild(opt);
  });

  // ✅ restore selection if still exists and auto-load the correct buyer basics
  if (keepUserId && users.some((u) => u.user_id === keepUserId)) {
    sel.value = keepUserId;
    setDisabled("saveBuyerBasicsBtn", false);
    loadBuyerBasicsForUser(keepUserId); // ✅ THIS is the key fix
  } else {
    sel.value = "";
    fillBuyerBasicsForm({});
    setDisabled("saveBuyerBasicsBtn", true);
  }
}

function fillBuyerBasicsForm(bb) {
  setValue("bb_name", bb?.name || "");
  setValue("bb_email", bb?.email || "");
  setValue("bb_phone", bb?.phone || "");
  setValue("bb_move_date", bb?.target_move_date || "");
  setValue("bb_preapproval", bb?.preapproval_status || "");
  setValue("bb_budget", bb?.budget_range || "");
  setValue("bb_areas", bb?.preferred_areas || "");
  setValue("bb_dealbreakers", bb?.dealbreakers || "");
}

function readBuyerBasicsForm() {
  return {
    name: safeText(getValue("bb_name")),
    email: safeText(getValue("bb_email")).toLowerCase(),
    phone: safeText(getValue("bb_phone")),
    target_move_date: getValue("bb_move_date") || "",
    preapproval_status: safeText(getValue("bb_preapproval")),
    budget_range: safeText(getValue("bb_budget")),
    preferred_areas: safeText(getValue("bb_areas")),
    dealbreakers: safeText(getValue("bb_dealbreakers")),
  };
}

async function loadBuyerBasicsForUser(userId) {
  if (!userId) {
    fillBuyerBasicsForm({});
    setDisabled("saveBuyerBasicsBtn", true);
    setBuyerBasicsStatus("");
    return;
  }

  try {
    setBuyerBasicsStatus("Loading buyer basics…");

    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/buyer-basics`, {
      credentials: "include",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load buyer basics");

    fillBuyerBasicsForm(data.buyer_basics || {});
    setDisabled("saveBuyerBasicsBtn", false);
    setBuyerBasicsStatus("Loaded.");
  } catch (e) {
    setBuyerBasicsStatus(e.message || "Load failed");
    setDisabled("saveBuyerBasicsBtn", true);
  }
}

async function saveBuyerBasics() {
  const userId = getValue("selectedUser");
  if (!userId) {
    setBuyerBasicsStatus("Select a buyer first.");
    return;
  }

  try {
    setBuyerBasicsStatus("Saving…");

    const payload = readBuyerBasicsForm();

    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/buyer-basics`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Save failed");

    setBuyerBasicsStatus("Saved ✅");
  } catch (e) {
    setBuyerBasicsStatus(e.message || "Save failed");
  }
}

/** ---------------------------
 *  BOOT
 *  --------------------------- */
window.addEventListener("DOMContentLoaded", () => {
  $("createUserBtn")?.addEventListener("click", createUser);
  $("refreshUsersBtn")?.addEventListener("click", refreshUsers);

  $("selectedUser")?.addEventListener("change", (e) => {
    loadBuyerBasicsForUser(e.target.value);
  });

  $("saveBuyerBasicsBtn")?.addEventListener("click", saveBuyerBasics);

  refreshUsers();
});
