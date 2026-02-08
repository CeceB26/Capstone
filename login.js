alert("login.js is running");
console.log("login.js is running");

// /Capstone/login.js
const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

async function login() {
  const email = ($("email")?.value || "").trim().toLowerCase();
  const password = $("password")?.value || "";

  if (!email || !password) {
    setStatus("Enter email and password.");
    return;
  }

  try {
    setStatus("Logging in…");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // ✅ ensures session cookie is stored
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Login failed");

    // Optional: confirm session works before redirect
    // (helps debugging a LOT)
    const me = await fetch("/api/buyer/context", { credentials: "include" });
    if (!me.ok) {
      throw new Error("Logged in, but session not detected. Check cookies/port.");
    }

    setStatus("Success. Redirecting…");
    window.location.href = "/Capstone/buyerUI.html";
  } catch (e) {
    setStatus(e.message || "Login failed");
  }
}

// ✅ Works whether you use a button or a <form>
window.addEventListener("DOMContentLoaded", () => {
  $("loginBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    login();
  });

  // If your login is inside a <form id="loginForm">, support Enter key:
  $("loginForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    login();
  });
});
