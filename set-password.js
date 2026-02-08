const $ = (id) => document.getElementById(id);

function qp(k){
  const url = new URL(window.location.href);
  return url.searchParams.get(k);
}
function setStatus(msg){ $("status").textContent = msg || ""; }

const token = qp("token");
const type = qp("type") || "setup";

$("modeLabel").textContent =
  type === "reset" ? "Reset your password below." : "Set your password below.";

$("setBtn").addEventListener("click", async () => {
  const p1 = $("p1").value;
  const p2 = $("p2").value;

  if(!token) return setStatus("Missing token. Please use the link from your email.");
  if(p1.length < 8) return setStatus("Password must be at least 8 characters.");
  if(p1 !== p2) return setStatus("Passwords do not match.");

  try{
    setStatus("Saving…");
    const res = await fetch("/api/auth/set-password", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ token, type, new_password: p1 })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Failed");

    setStatus("Password saved! Redirecting to login…");
    setTimeout(() => window.location.href = "/Capstone/login.html", 800);
  }catch(e){
    setStatus(e.message);
  }
});
