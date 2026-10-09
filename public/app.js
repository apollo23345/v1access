const screen = document.getElementById("screen");
const toastRegion = document.getElementById("toastRegion");

const state = {
  token: localStorage.getItem("vaultaccessToken") || "",
  deviceId: localStorage.getItem("vaultaccessDeviceId") || "",
  pendingId: "",
  challengeId: "",
  currentOtp: "",
  selectedMethod: "email",
  currentAccount: null,
  customerPage: "overview",
  selectedActivityId: ""
};

if (!state.deviceId) {
  state.deviceId = `device-${crypto.randomUUID()}`;
  localStorage.setItem("vaultaccessDeviceId", state.deviceId);
}

function deviceLabel() {
  const platform = navigator.platform || "Device";
  const browser = navigator.userAgent.includes("Chrome")
    ? "Chrome"
    : navigator.userAgent.includes("Firefox")
    ? "Firefox"
    : navigator.userAgent.includes("Safari")
    ? "Safari"
    : "Browser";
  return `${browser} on ${platform}`;
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({ ok: false, message: "Invalid server response." }));

  return { response, data };
}

function setToken(token) {
  state.token = token || "";
  if (state.token) localStorage.setItem("vaultaccessToken", state.token);
  else localStorage.removeItem("vaultaccessToken");
}

function render(templateId) {
  const template = document.getElementById(templateId);
  screen.replaceChildren(template.content.cloneNode(true));
  wireRoutes();
}

function setTopNav(active) {
  document.querySelectorAll(".nav-link").forEach(btn => btn.classList.remove("active"));
  document.querySelector(`.nav-link[data-route="${active}"]`)?.classList.add("active");
}

function wireRoutes() {
  screen.querySelectorAll("[data-route]").forEach(btn => {
    btn.addEventListener("click", () => route(btn.dataset.route));
  });
}

async function route(name) {
  if (name === "dashboard") {
    if (!state.token) {
      toast("Sign in required", "Use one of the dummy customer accounts first.");
      return showLogin();
    }
    return showDashboard(state.customerPage || "overview");
  }

  if (name === "login") return showLogin();
}

document.querySelectorAll(".topbar [data-route]").forEach(btn => {
  btn.addEventListener("click", () => route(btn.dataset.route));
});

function toast(title, message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
  toastRegion.appendChild(node);
  setTimeout(() => node.remove(), 3800);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function showLogin() {
  setTopNav("login");
  render("tpl-login");

  const email = document.getElementById("email");
  const password = document.getElementById("password");
  const toggle = document.getElementById("passwordToggle");
  const toggleText = document.getElementById("passwordToggleText");

  toggle.addEventListener("click", () => {
    const hidden = password.type === "password";
    password.type = hidden ? "text" : "password";
    toggleText.textContent = hidden ? "Hide" : "Show";
  });

  document.getElementById("forgotPasswordBtn").addEventListener("click", () => {
    toast("Demo note", "Use recovery@dummy.demo to demonstrate alternate recovery.");
  });

  const { data } = await api("/api/demo-accounts");
  const panel = document.getElementById("demoAccountsPanel");
  panel.innerHTML = data.accounts.map(account => `
    <button class="demo-account" data-email="${escapeHtml(account.email)}" data-password="${escapeHtml(account.password)}">
      <div>
        <strong>${escapeHtml(account.name)}</strong>
        <span>${escapeHtml(account.email)}</span>
        <span>${escapeHtml(account.subtitle)}</span>
      </div>
      <code>${escapeHtml(account.password)}</code>
    </button>
  `).join("") + `
    <div class="demo-reset-row">
      <button class="btn btn-light" id="loginResetDemoBtn">Reset Demo Data</button>
    </div>`;

  panel.querySelectorAll(".demo-account").forEach(btn => {
    btn.addEventListener("click", () => {
      email.value = btn.dataset.email;
      password.value = btn.dataset.password;
      toast("Demo account loaded", btn.dataset.email);
    });
  });

  document.getElementById("demoAccountsToggle").addEventListener("click", e => {
    panel.hidden = !panel.hidden;
    e.currentTarget.textContent = panel.hidden ? "View demo accounts" : "Hide demo accounts";
  });

  document.getElementById("loginResetDemoBtn").addEventListener("click", resetDemo);

  document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const signInBtn = document.getElementById("signInBtn");
    signInBtn.disabled = true;
    signInBtn.textContent = "Checking…";

    const { response, data } = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: email.value,
        password: password.value,
        remember: document.getElementById("rememberDevice").checked,
        deviceId: state.deviceId,
        deviceLabel: deviceLabel()
      })
    });

    signInBtn.disabled = false;
    signInBtn.textContent = "Sign in";

    if (!response.ok) {
      if (data.flow === "source-blocked") {
        return showSourceBlocked(data);
      }
      return toast("Sign-in failed", data.message || "Unable to sign in.");
    }

    if (data.flow === "level1") {
      setToken(data.token);
      state.currentAccount = data.user;
      return showLevel1();
    }

    state.pendingId = data.pendingId || "";

    if (data.flow === "level2") {
      state.challengeId = data.challengeId;
      state.currentOtp = data.demoOtp;
      return showLevel2();
    }

    if (data.flow === "protected") {
      return showProtected(Boolean(data.recoveryUnavailable));
    }
  });
}

function showLevel1() {
  setTopNav("login");
  render("tpl-level1");
  document.getElementById("level1Device").textContent = deviceLabel();
}

function showLevel2() {
  setTopNav("login");
  render("tpl-level2");
  document.getElementById("demoOtp").textContent = state.currentOtp;

  document.getElementById("otpForm").addEventListener("submit", async e => {
    e.preventDefault();
    const code = document.getElementById("otpInput").value.trim();

    const { response, data } = await api("/api/challenge/verify", {
      method: "POST",
      body: JSON.stringify({
        challengeId: state.challengeId,
        code
      })
    });

    if (!response.ok) {
      if (data.flow === "source-blocked") return showSourceBlocked(data);
      return toast("Verification failed", data.message);
    }

    setToken(data.token);
    state.customerPage = "overview";
    toast("Device verified", "Level 2 verification completed successfully.");
    showDashboard("overview");
  });
}

function showProtected(recoveryUnavailable = false) {
  setTopNav("login");
  render("tpl-protected");

  if (recoveryUnavailable) {
    const note = document.createElement("div");
    note.className = "info-panel purple";
    note.innerHTML = "<strong>Recovery-channel demo</strong>This account is configured as unable to access SMS/email so you can demonstrate Alternate Verification.";
    document.querySelector(".center-card").insertBefore(note, document.getElementById("startChallengeBtn"));
  }

  document.getElementById("startChallengeBtn").addEventListener("click", () => {
    if (recoveryUnavailable) return showRecovery();
    showChallenge();
  });
}

function showChallenge() {
  setTopNav("login");
  render("tpl-challenge");

  document.querySelectorAll("[data-method]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-method]").forEach(x => x.classList.remove("selected"));
      btn.classList.add("selected");
      state.selectedMethod = btn.dataset.method;
    });
  });

  document.getElementById("cantAccessBtn").addEventListener("click", showRecovery);

  document.getElementById("generateChallengeBtn").addEventListener("click", async () => {
    const { response, data } = await api("/api/challenge/start", {
      method: "POST",
      body: JSON.stringify({
        pendingId: state.pendingId,
        method: state.selectedMethod
      })
    });

    if (!response.ok) {
      if (data.recoveryRequired) return showRecovery();
      return toast("Challenge unavailable", data.message);
    }

    state.challengeId = data.challengeId;
    state.currentOtp = data.demoOtp;
    showChallengeCode();
  });
}

function showChallengeCode() {
  setTopNav("login");
  render("tpl-challenge-code");
  document.getElementById("challengeDemoOtp").textContent = state.currentOtp;
  document.getElementById("challengeCantAccessBtn").addEventListener("click", showRecovery);

  document.getElementById("challengeOtpForm").addEventListener("submit", async e => {
    e.preventDefault();
    const code = document.getElementById("challengeOtpInput").value.trim();

    const { response, data } = await api("/api/challenge/verify", {
      method: "POST",
      body: JSON.stringify({
        challengeId: state.challengeId,
        code
      })
    });

    if (!response.ok) {
      if (data.flow === "source-blocked") return showSourceBlocked(data);
      return toast("Verification failed", data.message);
    }

    setToken(data.token);
    state.customerPage = "overview";
    toast("Identity verified", "Protected Mode passed. The account remains available under cooldown.");
    showDashboard("overview");
  });
}

function showRecovery() {
  setTopNav("login");
  render("tpl-recovery");

  document.getElementById("recoveryForm").addEventListener("submit", async e => {
    e.preventDefault();

    const { response, data } = await api("/api/recovery/verify", {
      method: "POST",
      body: JSON.stringify({
        pendingId: state.pendingId,
        recoveryCode: document.getElementById("recoveryCodeInput").value.trim()
      })
    });

    if (!response.ok) return toast("Recovery failed", data.message);

    setToken(data.token);
    toast("Recovery successful", "Alternate verification restored access without a forced account-wide lockout.");
    showDashboard("overview");
  });
}

function showSourceBlocked(data = {}) {
  setTopNav("login");
  render("tpl-source-blocked");

  const blockTime = document.getElementById("sourceBlockTime");
  if (data.blockedUntil) {
    blockTime.textContent = `Temporary restriction until ${formatTime(data.blockedUntil)}.`;
  } else {
    blockTime.textContent = "This source is temporarily restricted.";
  }

  document.getElementById("resetDemoBtn").addEventListener("click", resetDemo);
}

async function resetDemo() {
  await api("/api/reset-demo", { method: "POST", body: "{}" });
  setToken("");
  state.pendingId = "";
  state.challengeId = "";
  state.currentOtp = "";
  state.currentAccount = null;
  toast("Demo reset", "Account state, source blocks, activities, and sessions were reset.");
  showLogin();
}

async function loadAccount() {
  const { response, data } = await api("/api/me");
  if (!response.ok) {
    setToken("");
    return null;
  }
  state.currentAccount = data.account;
  return data.account;
}

async function showDashboard(page = "overview") {
  setTopNav("dashboard");
  state.customerPage = page;

  const account = await loadAccount();
  if (!account) return showLogin();

  render("tpl-dashboard");

  document.getElementById("dashboardName").textContent = account.name;
  document.getElementById("dashboardEmail").textContent = account.email;

  document.querySelectorAll("[data-customer-page]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.customerPage === page);
    btn.addEventListener("click", () => showDashboard(btn.dataset.customerPage));
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    setToken("");
    state.currentAccount = null;
    toast("Signed out", "Your current session was ended.");
    showLogin();
  });

  const titles = {
    overview: "Account Security Overview",
    activity: "Security Activity",
    sessions: "Active Sessions",
    checkup: "Security Checkup",
    recovery: "Recovery"
  };
  document.getElementById("dashboardTitle").textContent = titles[page] || titles.overview;

  if (page === "overview") renderOverview(account);
  if (page === "activity") renderActivity(account);
  if (page === "sessions") renderSessions(account);
  if (page === "checkup") renderCheckup(account);
  if (page === "recovery") renderRecoveryDashboard(account);
}

function renderOverview(account) {
  const content = document.getElementById("dashboardContent");
  const levelClass = account.securityLevel.includes("LEVEL 3") ? "orange" : account.securityLevel.includes("LEVEL 2") ? "blue" : "green";

  content.innerHTML = `
    <div class="stat-grid">
      <button class="stat-card clickable" data-page="checkup">
        <div class="stat-label">Account Status</div>
        <div class="stat-value green">PROTECTED</div>
        <div class="stat-sub">Your account remains available.</div>
      </button>
      <button class="stat-card clickable" data-page="activity">
        <div class="stat-label">Security Level</div>
        <div class="stat-value ${levelClass}">${escapeHtml(account.securityLevel)}</div>
        <div class="stat-sub">Click to review recent security activity.</div>
      </button>
      <button class="stat-card clickable" data-page="sessions">
        <div class="stat-label">Trusted Devices</div>
        <div class="stat-value">${account.trustedDevices}</div>
        <div class="stat-sub">${account.activeBlockedSources} suspicious source(s) currently restricted.</div>
      </button>
    </div>

    ${account.activeBlockedSources ? `
      <div class="info-panel green">
        <strong>${account.activeBlockedSources} suspicious source(s) restricted</strong>
        Your account itself was not automatically locked. Trusted access remains available.
      </div>` : ""}

    <div class="dash-grid">
      <div class="dash-card">
        <div class="card-title-row"><h3>Recent Activity</h3><button class="text-link" data-page="activity">View all</button></div>
        <div class="activity-list">
          ${account.activities.slice(0, 4).map(activityButton).join("") || '<div class="info-panel gray"><strong>No activity yet</strong>Sign-in activity will appear here.</div>'}
        </div>
      </div>

      <div class="dash-card">
        <div class="card-title-row"><h3>Active Sessions</h3><button class="text-link" data-page="sessions">Manage</button></div>
        <div class="device-list">
          ${account.sessions.slice(0, 4).map(session => `
            <button class="device-item" data-page="sessions">
              <strong>${escapeHtml(session.label)}</strong>
              <span class="pill ${session.current ? "green" : "gray"}">${session.current ? "Current" : "Active"}</span>
            </button>`).join("")}
        </div>
      </div>
    </div>

    <button class="recommend clickable" data-page="checkup">
      <strong>Security Recommendations</strong>
      Review unfamiliar activity and keep recovery options ready.
    </button>
  `;

  content.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => showDashboard(btn.dataset.page));
  });

  content.querySelectorAll("[data-activity-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedActivityId = btn.dataset.activityId;
      showDashboard("activity");
    });
  });
}

function activityButton(activity) {
  const cls = activity.status === "Verified" || activity.status === "Recognized" || activity.status === "Completed"
    ? ""
    : activity.status === "Blocked" || activity.status === "Reported"
    ? "red"
    : "orange";

  return `
    <button class="activity-item" data-activity-id="${escapeHtml(activity.id)}">
      <span class="activity-dot ${cls}"></span>
      <div><strong>${escapeHtml(activity.title)}</strong><span>${escapeHtml(activity.source)} · ${formatTime(activity.time)}</span></div>
      <span>›</span>
    </button>`;
}

function renderActivity(account) {
  const content = document.getElementById("dashboardContent");
  const selected = account.activities.find(a => a.id === state.selectedActivityId) || account.activities[0];

  content.innerHTML = `
    <div class="dash-grid">
      <div class="page-card">
        <h3>Recent Events</h3>
        <div class="activity-list">
          ${account.activities.map(activityButton).join("") || '<div class="info-panel gray"><strong>No activity yet</strong>Nothing to review.</div>'}
        </div>
      </div>

      <div class="page-card">
        ${selected ? `
          <div class="card-title-row">
            <h3>${escapeHtml(selected.title)}</h3>
            <span class="pill ${selected.status === "Blocked" || selected.status === "Reported" ? "red" : "blue"}">${escapeHtml(selected.status)}</span>
          </div>
          <div class="info-panel gray">
            <div class="info-grid">
              <span>Source</span><strong>${escapeHtml(selected.source)}</strong>
              <span>Time</span><strong>${formatTime(selected.time)}</strong>
              <span>Status</span><strong>${escapeHtml(selected.status)}</strong>
            </div>
          </div>
          <div class="activity-detail"><p>${escapeHtml(selected.details)}</p></div>
          <div class="inline-actions">
            <button class="btn btn-success" data-activity-action="mine" data-id="${escapeHtml(selected.id)}">Yes, this was me</button>
            <button class="btn btn-danger" data-activity-action="not-mine" data-id="${escapeHtml(selected.id)}">No, secure this</button>
          </div>
        ` : '<div class="info-panel gray"><strong>Select an event</strong>Choose activity from the list.</div>'}
      </div>
    </div>
  `;

  content.querySelectorAll("[data-activity-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedActivityId = btn.dataset.activityId;
      showDashboard("activity");
    });
  });

  content.querySelectorAll("[data-activity-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { response, data } = await api("/api/activity/action", {
        method: "POST",
        body: JSON.stringify({
          activityId: btn.dataset.id,
          action: btn.dataset.activityAction
        })
      });

      if (!response.ok) return toast("Unable to update", data.message);
      toast("Activity updated", btn.dataset.activityAction === "mine" ? "Marked as your activity." : "Reported and security action applied.");
      showDashboard("activity");
    });
  });
}

function renderSessions(account) {
  const content = document.getElementById("dashboardContent");

  content.innerHTML = `
    <div class="page-card">
      <h3>Signed-In Devices</h3>
      <div class="sessions">
        ${account.sessions.map(session => `
          <div class="session ${session.current ? "current" : ""}">
            <span class="session-icon">${session.label.charAt(0).toUpperCase()}</span>
            <div>
              <strong>${escapeHtml(session.label)}</strong>
              <span>${escapeHtml(session.location)} · ${formatTime(session.createdAt)}</span>
            </div>
            ${session.current
              ? '<span class="pill green">CURRENT</span>'
              : `<button class="btn btn-outline" data-revoke-session="${escapeHtml(session.id)}">Sign Out</button>`}
          </div>
        `).join("")}
      </div>
    </div>
  `;

  content.querySelectorAll("[data-revoke-session]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { response, data } = await api("/api/sessions/revoke", {
        method: "POST",
        body: JSON.stringify({ sessionId: btn.dataset.revokeSession })
      });

      if (!response.ok) return toast("Unable to sign out", data.message);
      toast("Session ended", "The selected device session was revoked.");
      showDashboard("sessions");
    });
  });
}

function renderCheckup(account) {
  const c = account.securityCheckup;
  const completed = Number(c.passwordSecure) + Number(c.mfaEnabled) + Number(c.recoveryCodesReady) + 2;

  document.getElementById("dashboardContent").innerHTML = `
    <div class="page-card">
      <div class="info-panel blue">
        <strong>Security status</strong>
        ${completed} of 5 recommended controls are configured.
      </div>

      <div class="check-list">
        <div class="check-row"><span class="check-icon good">✓</span><div><strong>Password Secure</strong><span>Dummy account password check is healthy.</span></div><span class="pill green">OK</span></div>
        <div class="check-row"><span class="check-icon good">✓</span><div><strong>MFA Enabled</strong><span>Step-up verification is available.</span></div><span class="pill green">OK</span></div>
        <div class="check-row"><span class="check-icon good">✓</span><div><strong>Source Rate-Limiting</strong><span>Repeated failed attempts can be blocked per source.</span></div><span class="pill green">OK</span></div>
        <div class="check-row"><span class="check-icon good">✓</span><div><strong>Session Review</strong><span>Active sessions can be reviewed and revoked.</span></div><span class="pill green">OK</span></div>
        <div class="check-row"><span class="check-icon ${c.recoveryCodesReady ? "good" : "warn"}">${c.recoveryCodesReady ? "✓" : "!"}</span><div><strong>Recovery Code</strong><span>${c.recoveryCodesReady ? "Emergency recovery code is configured." : "Set up an emergency recovery code."}</span></div>${c.recoveryCodesReady ? '<span class="pill green">READY</span>' : '<button class="btn btn-outline" id="setupRecoveryBtn">Set Up</button>'}</div>
      </div>
    </div>
  `;

  document.getElementById("setupRecoveryBtn")?.addEventListener("click", async () => {
    const { response, data } = await api("/api/security/recovery-code", { method: "POST", body: "{}" });
    if (!response.ok) return toast("Unable to set up", data.message);
    toast("Recovery code ready", `Demo recovery code: ${data.recoveryCode}`);
    showDashboard("checkup");
  });
}

function renderRecoveryDashboard(account) {
  document.getElementById("dashboardContent").innerHTML = `
    <div class="page-card">
      <div class="info-panel purple">
        <strong>Alternate recovery</strong>
        Use this if the customer cannot access the normal SMS/email channels.
      </div>
      <div class="option-list">
        <button class="option" id="showRecoveryCodeBtn"><span class="option-icon">R</span><div><strong>Recovery Code</strong><span>View the demo fallback code.</span></div><span>›</span></button>
        <button class="option" data-page="checkup"><span class="option-icon">✓</span><div><strong>Security Checkup</strong><span>Review whether recovery is configured.</span></div><span>›</span></button>
      </div>
      <div id="recoveryCodeReveal"></div>
    </div>
  `;

  document.getElementById("showRecoveryCodeBtn").addEventListener("click", () => {
    document.getElementById("recoveryCodeReveal").innerHTML = `
      <div class="demo-code-box purple-box"><span>Demo recovery code</span><strong style="font-size:14px;letter-spacing:.06em;">RECOVER-2026</strong></div>`;
  });

  document.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => showDashboard(btn.dataset.page));
  });
}

if (state.token) {
  showDashboard("overview");
} else {
  showLogin();
}
