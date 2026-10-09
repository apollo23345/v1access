const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DB_FILE = path.join(ROOT, "data", "db.json");

const sessions = new Map();
const pendingLogins = new Map();
const otpChallenges = new Map();

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function verifyPassword(account, password) {
  return sha256(`${account.passwordSalt}::${password}`) === account.passwordHash;
}

function nowIso() {
  return new Date().toISOString();
}

function addActivity(account, {
  type,
  title,
  source,
  sourceId = "",
  status,
  details
}) {
  const item = {
    id: crypto.randomUUID(),
    time: nowIso(),
    type,
    title,
    source,
    sourceId,
    status,
    details
  };
  account.activities.unshift(item);
  account.activities = account.activities.slice(0, 30);
  return item;
}

function cleanExpiredBlocks(account) {
  const now = Date.now();
  Object.entries(account.blockedSources || {}).forEach(([deviceId, block]) => {
    if (new Date(block.until).getTime() <= now) {
      delete account.blockedSources[deviceId];
    }
  });
}

function isSourceBlocked(account, deviceId) {
  cleanExpiredBlocks(account);
  const block = account.blockedSources?.[deviceId];
  return block || null;
}

function blockSource(account, deviceId, reason = "Repeated high-risk failures", seconds = 60) {
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  account.blockedSources ||= {};
  account.blockedSources[deviceId] = { reason, until };
  addActivity(account, {
    type: "source-block",
    title: "Suspicious source blocked",
    source: deviceId,
    sourceId: deviceId,
    status: "Blocked",
    details: `${reason}. Customer account remains available from other trusted access.`
  });
  return account.blockedSources[deviceId];
}

function createSession(account, deviceId, deviceLabel, level, trusted) {
  const token = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const session = {
    token,
    sessionId,
    accountId: account.id,
    deviceId,
    deviceLabel,
    level,
    trusted,
    createdAt: nowIso()
  };
  sessions.set(token, session);

  account.sessions = (account.sessions || []).filter(s => s.id !== sessionId);
  account.sessions.unshift({
    id: sessionId,
    deviceId,
    label: deviceLabel,
    location: "Local Demo Browser",
    createdAt: session.createdAt,
    current: true
  });

  return session;
}

function getAuth(req, db) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = sessions.get(token);
  if (!session) return null;
  const account = db.accounts.find(a => a.id === session.accountId);
  if (!account) return null;
  return { session, account, token };
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendFile(res, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  };

  const data = fs.readFileSync(file);
  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Content-Length": data.length
  });
  res.end(data);
}

function issueOtp(pendingId, method = "email") {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const challengeId = crypto.randomUUID();
  otpChallenges.set(challengeId, {
    pendingId,
    method,
    code,
    attempts: 0,
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  return { challengeId, code };
}

function accountSummary(account, session) {
  cleanExpiredBlocks(account);
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    securityLevel: session.level,
    trustedDevices: account.trustedDevices.length,
    activeBlockedSources: Object.keys(account.blockedSources || {}).length,
    activities: account.activities,
    sessions: account.sessions.map(s => ({
      ...s,
      current: s.id === session.sessionId
    })),
    securityCheckup: account.securityCheckup
  };
}

function seedDemoReset() {
  const current = readDb();
  for (const account of current.accounts) {
    account.trustedDevices = [];
    account.blockedSources = {};
    account.activities = [];
    account.securityCheckup = {
      passwordSecure: true,
      mfaEnabled: true,
      recoveryCodesReady: false
    };
    account.sessions = [];
  }

  const maria = current.accounts.find(a => a.email === "level1@dummy.demo");
  if (maria) {
    maria.sessions = [{
      id: "seed-iphone",
      deviceId: "seed-iphone",
      label: "iPhone 13",
      location: "Manila, Philippines",
      createdAt: "2026-10-07T12:10:00.000Z",
      current: false
    }];
  }

  const carlo = current.accounts.find(a => a.email === "level2@dummy.demo");
  if (carlo) {
    carlo.sessions = [{
      id: "seed-android",
      deviceId: "seed-android",
      label: "Android Phone",
      location: "Quezon City, Philippines",
      createdAt: "2026-10-07T10:30:00.000Z",
      current: false
    }];
  }

  writeDb(current);
  sessions.clear();
  pendingLogins.clear();
  otpChallenges.clear();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/demo-accounts" && req.method === "GET") {
      const db = readDb();
      return json(res, 200, {
        accounts: db.accounts.map(a => ({
          name: a.name,
          email: a.email,
          password: "Vault123!",
          profile: a.profile,
          subtitle: a.profileSubtitle
        })),
        recoveryCode: "RECOVER-2026"
      });
    }

    if (url.pathname === "/api/reset-demo" && req.method === "POST") {
      seedDemoReset();
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const deviceId = String(body.deviceId || "unknown-device");
      const deviceLabel = String(body.deviceLabel || "Browser");
      const remember = Boolean(body.remember);

      const db = readDb();
      const account = db.accounts.find(a => a.email.toLowerCase() === email);

      if (!account) {
        return json(res, 401, { ok: false, message: "Invalid email or password." });
      }

      const blocked = isSourceBlocked(account, deviceId);
      if (blocked) {
        writeDb(db);
        return json(res, 429, {
          ok: false,
          flow: "source-blocked",
          message: "This sign-in source is temporarily blocked.",
          blockedUntil: blocked.until,
          reason: blocked.reason
        });
      }

      account.failedBySource ||= {};
      const failState = account.failedBySource[deviceId] || { count: 0 };

      if (!verifyPassword(account, password)) {
        failState.count += 1;
        failState.lastAt = nowIso();
        account.failedBySource[deviceId] = failState;

        addActivity(account, {
          type: "failed-login",
          title: "Failed password attempt",
          source: deviceLabel,
          sourceId: deviceId,
          status: failState.count >= 3 ? "Rate limited" : "Failed",
          details: `Failed password attempt ${failState.count} from this source.`
        });

        if (failState.count >= 3) {
          const block = blockSource(account, deviceId, "Three failed password attempts from the same source", 60);
          writeDb(db);
          return json(res, 429, {
            ok: false,
            flow: "source-blocked",
            message: "This source was blocked after repeated failed passwords. The customer account itself was not locked.",
            blockedUntil: block.until
          });
        }

        writeDb(db);
        return json(res, 401, {
          ok: false,
          message: `Incorrect password. ${3 - failState.count} attempt(s) remain before this source is temporarily blocked.`,
          failedAttempts: failState.count
        });
      }

      const recentFailures = failState.count;
      account.failedBySource[deviceId] = { count: 0, lastAt: nowIso() };

      const trusted = account.trustedDevices.includes(deviceId);
      let flow = "level1";

      if (account.profile === "standard") {
        // For the demo, Maria's first browser is considered her recognized device.
        if (!trusted) {
          account.trustedDevices.push(deviceId);
        }
        flow = "level1";
      } else if (account.profile === "new-device") {
        flow = trusted ? "level1" : "level2";
      } else if (account.profile === "high-risk" || recentFailures >= 2) {
        flow = "protected";
      } else if (account.profile === "recovery") {
        flow = "protected";
      }

      const pendingId = crypto.randomUUID();
      pendingLogins.set(pendingId, {
        accountId: account.id,
        deviceId,
        deviceLabel,
        remember,
        flow,
        createdAt: Date.now()
      });

      addActivity(account, {
        type: "login",
        title: flow === "level1" ? "Recognized sign-in" : flow === "level2" ? "New device verification required" : "Protected Mode triggered",
        source: deviceLabel,
        sourceId: deviceId,
        status: flow === "level1" ? "Recognized" : "Verification Required",
        details: flow === "level1"
          ? "Known low-risk sign-in."
          : flow === "level2"
          ? "Correct password from an unfamiliar device."
          : "High-risk profile or recent failed attempts require stronger verification."
      });

      if (flow === "level1") {
        const session = createSession(account, deviceId, deviceLabel, "LEVEL 1 · STANDARD", true);
        writeDb(db);
        return json(res, 200, {
          ok: true,
          flow: "level1",
          token: session.token,
          user: { name: account.name, email: account.email }
        });
      }

      if (flow === "level2") {
        const otp = issueOtp(pendingId, "email");
        writeDb(db);
        return json(res, 200, {
          ok: true,
          flow: "level2",
          pendingId,
          challengeId: otp.challengeId,
          demoOtp: otp.code,
          message: "A demo OTP was generated for the unfamiliar device."
        });
      }

      writeDb(db);
      return json(res, 200, {
        ok: true,
        flow: "protected",
        pendingId,
        recoveryUnavailable: Boolean(account.recoveryUnavailable),
        message: "Protected Mode requires a final identity challenge."
      });
    }

    if (url.pathname === "/api/challenge/start" && req.method === "POST") {
      const body = await readBody(req);
      const pending = pendingLogins.get(body.pendingId);
      if (!pending) {
        return json(res, 400, { ok: false, message: "Login challenge expired. Sign in again." });
      }

      const db = readDb();
      const account = db.accounts.find(a => a.id === pending.accountId);
      if (!account) return json(res, 404, { ok: false, message: "Account not found." });

      if (account.recoveryUnavailable) {
        return json(res, 409, {
          ok: false,
          recoveryRequired: true,
          message: "This demo account cannot access SMS/email. Use Alternate Verification."
        });
      }

      const method = body.method === "sms" ? "sms" : "email";
      const otp = issueOtp(body.pendingId, method);

      return json(res, 200, {
        ok: true,
        challengeId: otp.challengeId,
        demoOtp: otp.code,
        method
      });
    }

    if (url.pathname === "/api/challenge/verify" && req.method === "POST") {
      const body = await readBody(req);
      const challenge = otpChallenges.get(body.challengeId);
      if (!challenge || challenge.expiresAt < Date.now()) {
        return json(res, 400, { ok: false, message: "OTP expired. Request a new code." });
      }

      const pending = pendingLogins.get(challenge.pendingId);
      if (!pending) return json(res, 400, { ok: false, message: "Login challenge expired." });

      const db = readDb();
      const account = db.accounts.find(a => a.id === pending.accountId);
      if (!account) return json(res, 404, { ok: false, message: "Account not found." });

      if (String(body.code || "") !== challenge.code) {
        challenge.attempts += 1;

        addActivity(account, {
          type: "otp-failed",
          title: "Failed identity challenge",
          source: pending.deviceLabel,
          sourceId: pending.deviceId,
          status: challenge.attempts >= 3 ? "Blocked" : "Failed",
          details: `Identity challenge failed ${challenge.attempts} time(s).`
        });

        if (challenge.attempts >= 3) {
          const block = blockSource(account, pending.deviceId, "Three failed identity-challenge attempts", 60);
          writeDb(db);
          return json(res, 429, {
            ok: false,
            flow: "source-blocked",
            message: "This suspicious source was blocked. Other trusted access remains available.",
            blockedUntil: block.until
          });
        }

        writeDb(db);
        return json(res, 401, {
          ok: false,
          message: `Incorrect code. ${3 - challenge.attempts} attempt(s) remain before this source is blocked.`
        });
      }

      if (pending.remember && !account.trustedDevices.includes(pending.deviceId)) {
        account.trustedDevices.push(pending.deviceId);
      }

      delete account.blockedSources?.[pending.deviceId];

      const level = pending.flow === "protected" ? "LEVEL 3 · COOLDOWN" : "LEVEL 2 · STANDARD";
      const session = createSession(account, pending.deviceId, pending.deviceLabel, level, pending.remember);

      addActivity(account, {
        type: "verification-success",
        title: pending.flow === "protected" ? "Final identity challenge passed" : "Device verification passed",
        source: pending.deviceLabel,
        sourceId: pending.deviceId,
        status: "Verified",
        details: pending.flow === "protected"
          ? "High-risk sign-in verified. Account remains available with cooldown."
          : "New device verified successfully."
      });

      pendingLogins.delete(challenge.pendingId);
      otpChallenges.delete(body.challengeId);
      writeDb(db);

      return json(res, 200, {
        ok: true,
        token: session.token,
        securityLevel: level,
        user: { name: account.name, email: account.email }
      });
    }

    if (url.pathname === "/api/recovery/verify" && req.method === "POST") {
      const body = await readBody(req);
      const pending = pendingLogins.get(body.pendingId);
      if (!pending) {
        return json(res, 400, { ok: false, message: "Recovery challenge expired. Sign in again." });
      }

      const db = readDb();
      const account = db.accounts.find(a => a.id === pending.accountId);
      if (!account) return json(res, 404, { ok: false, message: "Account not found." });

      if (String(body.recoveryCode || "").trim().toUpperCase() !== String(account.recoveryCode).toUpperCase()) {
        addActivity(account, {
          type: "recovery-failed",
          title: "Alternate verification failed",
          source: pending.deviceLabel,
          sourceId: pending.deviceId,
          status: "Failed",
          details: "Incorrect recovery code."
        });
        writeDb(db);
        return json(res, 401, { ok: false, message: "Incorrect recovery code." });
      }

      if (pending.remember && !account.trustedDevices.includes(pending.deviceId)) {
        account.trustedDevices.push(pending.deviceId);
      }

      delete account.blockedSources?.[pending.deviceId];

      const session = createSession(account, pending.deviceId, pending.deviceLabel, "LEVEL 3 · COOLDOWN", pending.remember);

      addActivity(account, {
        type: "recovery-success",
        title: "Alternate verification passed",
        source: pending.deviceLabel,
        sourceId: pending.deviceId,
        status: "Verified",
        details: "Independent recovery code verified successfully."
      });

      pendingLogins.delete(body.pendingId);
      writeDb(db);

      return json(res, 200, {
        ok: true,
        token: session.token,
        securityLevel: "LEVEL 3 · COOLDOWN"
      });
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      const db = readDb();
      const auth = getAuth(req, db);
      if (!auth) return json(res, 401, { ok: false, message: "Not signed in." });
      writeDb(db);
      return json(res, 200, { ok: true, account: accountSummary(auth.account, auth.session) });
    }

    if (url.pathname === "/api/activity/action" && req.method === "POST") {
      const body = await readBody(req);
      const db = readDb();
      const auth = getAuth(req, db);
      if (!auth) return json(res, 401, { ok: false, message: "Not signed in." });

      const activity = auth.account.activities.find(a => a.id === body.activityId);
      if (!activity) return json(res, 404, { ok: false, message: "Activity not found." });

      if (body.action === "mine") {
        activity.status = "Confirmed by you";
        activity.details += " Customer confirmed this activity.";
      } else if (body.action === "not-mine") {
        activity.status = "Reported";
        activity.details += " Customer reported this activity as unauthorized.";
        blockSource(auth.account, activity.sourceId || activity.source, "Customer reported activity as unauthorized", 60);
      } else {
        return json(res, 400, { ok: false, message: "Unknown activity action." });
      }

      writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/sessions/revoke" && req.method === "POST") {
      const body = await readBody(req);
      const db = readDb();
      const auth = getAuth(req, db);
      if (!auth) return json(res, 401, { ok: false, message: "Not signed in." });

      const target = auth.account.sessions.find(s => s.id === body.sessionId);
      if (!target) return json(res, 404, { ok: false, message: "Session not found." });
      if (target.id === auth.session.sessionId) {
        return json(res, 400, { ok: false, message: "Use Logout to end the current session." });
      }

      auth.account.sessions = auth.account.sessions.filter(s => s.id !== body.sessionId);
      addActivity(auth.account, {
        type: "session-revoked",
        title: "Session revoked",
        source: target.label,
        status: "Ended",
        details: "Customer ended this session from Active Sessions."
      });
      writeDb(db);

      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/security/recovery-code" && req.method === "POST") {
      const db = readDb();
      const auth = getAuth(req, db);
      if (!auth) return json(res, 401, { ok: false, message: "Not signed in." });

      auth.account.securityCheckup.recoveryCodesReady = true;
      addActivity(auth.account, {
        type: "security-checkup",
        title: "Recovery code configured",
        source: "Security Checkup",
        status: "Completed",
        details: "Emergency recovery option configured."
      });
      writeDb(db);

      return json(res, 200, { ok: true, recoveryCode: auth.account.recoveryCode });
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      const db = readDb();
      const auth = getAuth(req, db);
      if (auth) {
        auth.account.sessions = auth.account.sessions.filter(s => s.id !== auth.session.sessionId);
        sessions.delete(auth.token);
        writeDb(db);
      }
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith("/api/")) {
      return json(res, 404, { ok: false, message: "API route not found." });
    }

    let filePath = url.pathname === "/" ? path.join(PUBLIC, "index.html") : path.join(PUBLIC, url.pathname);
    filePath = path.normalize(filePath);

    if (!filePath.startsWith(PUBLIC)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!fs.existsSync(filePath)) {
      filePath = path.join(PUBLIC, "index.html");
    }

    sendFile(res, filePath);
  } catch (err) {
    console.error(err);
    json(res, 500, { ok: false, message: "Server error." });
  }
});

server.listen(PORT, () => {
  console.log(`VaultAccess running at http://localhost:${PORT}`);
});
