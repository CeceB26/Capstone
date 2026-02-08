function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? "";
}

function formatDateNice(isoOrText) {
  const s = String(isoOrText || "").trim();
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

async function loadBuyerBasics() {
  const res = await fetch("/api/buyer/context", { credentials: "include" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    window.location.href = "/Capstone/login.html";
    return;
  }

  const bb = data.buyer_basics || {};

  setText("sessionHint", bb.email ? `Logged in as: ${bb.email}` : "");
  setText("buyerFullName", bb.name || "—");
  setText("buyerEmail", bb.email || "—");
  setText("buyerPhone", bb.phone || "—");
  setText("targetMoveDate", formatDateNice(bb.target_move_date) || "—");
  setText("preapproval", bb.preapproval_status || "—");
  setText("budgetRange", bb.budget_range || "—");
  setText("areas", bb.preferred_areas || "—");
  setText("dealbreakers", bb.dealbreakers || "—");

  setText("welcomeName", bb.name ? `Welcome, ${bb.name}!` : "Welcome!");
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadBuyerBasics();
  } catch (e) {
    console.error("loadBuyerBasics failed:", e);
  }
});
