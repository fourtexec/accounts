/* fourtexec accounts — sign in, sign up, profile, security.
   no framework, no build step. talks to the api in config.js with
   the shared session cookie (.fourtexec.site). */

"use strict";

var CFG = window.FTX_CONFIG;

/* ================================================================
   helpers
   ================================================================ */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function fmtDate(iso, withTime) {
  if (!iso) return "—";
  var d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ago(iso) {
  if (!iso) return "never";
  var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
  return fmtDate(iso);
}

function describeUA(ua) {
  if (!ua) return "unknown device";
  var browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /okhttp|Dalvik/i.test(ua) ? "Android app"
    : /curl|node|python|go-http/i.test(ua) ? "script" : "browser";
  var os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return browser + (os ? " · " + os : "");
}

function toast(msg) {
  var old = $(".toast");
  if (old) old.remove();
  var t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 3200);
}

function copy(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("copied"); });
}

function download(name, text) {
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

function avatar(user, size) {
  var letter = esc(((user && (user.displayName || user.username)) || "?").trim().charAt(0).toUpperCase());
  var img = user && user.avatarUrl
    ? '<img src="' + esc(user.avatarUrl) + '" alt="" referrerpolicy="no-referrer" data-hide-on-error>'
    : "";
  return '<span class="avatar ' + size + '">' + letter + img + "</span>";
}

function roleChip(role) {
  if (!role || role === "user") return "";
  return '<span class="chip role-' + esc(role) + '">' + esc(role) + "</span>";
}

/** Only redirect back to our own sites. */
function safeNext(url) {
  if (!url) return null;
  try {
    var u = new URL(url);
    var host = u.hostname;
    var ours = host === "fourtexec.site" || /\.fourtexec\.site$/.test(host);
    var local = /^(localhost|127\.0\.0\.1)$/.test(host) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if ((u.protocol === "https:" && ours) || local) return u.href;
  } catch (e) {}
  return null;
}

/* ================================================================
   api
   ================================================================ */

function api(method, path, data) {
  var opts = { method: method, credentials: "include", headers: {} };
  if (data !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(data);
  }
  return fetch(CFG.api + path, opts).then(
    function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          var err = (body && body.error) || {};
          var e = new Error(err.message || "Request failed (" + res.status + ")");
          e.status = res.status;
          e.code = err.code;
          e.details = err.details || {};
          throw e;
        }
        return body;
      });
    },
    function () {
      var e = new Error("Can't reach the server — check your connection and try again");
      e.code = "network";
      throw e;
    }
  );
}

/* ================================================================
   forms
   ================================================================ */

function field(name, label, opts) {
  opts = opts || {};
  var type = opts.type || "text";
  var attrs = ' name="' + name + '" id="f-' + name + '"' +
    (opts.autocomplete ? ' autocomplete="' + opts.autocomplete + '"' : "") +
    (opts.required ? " required" : "") +
    (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : "") +
    (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : "") +
    (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : "") +
    (opts.autofocus ? " autofocus" : "");
  var cls = "input" + (opts.code ? " code" : "");
  var control = type === "textarea"
    ? '<textarea class="' + cls + '"' + attrs + ">" + esc(opts.value || "") + "</textarea>"
    : '<input class="' + cls + '" type="' + type + '"' + attrs + ' value="' + esc(opts.value || "") + '">';
  return '<label class="field" data-field="' + name + '"><span>' + esc(label) + "</span>" + control +
    (opts.hint ? '<small class="hint">' + esc(opts.hint) + "</small>" : "") + "</label>";
}

/**
 * Wires a <form>: collects values, calls handler, shows field errors.
 * handler returns a promise; a thrown api error is rendered in the form.
 */
function bindForm(form, handler) {
  if (!form) return;
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var btn = form.querySelector("button[type=submit]");
    var values = {};
    $$("input, textarea, select", form).forEach(function (el) {
      if (!el.name) return;
      values[el.name] = el.type === "checkbox" ? el.checked : el.value;
    });
    $$(".field-error", form).forEach(function (el) { el.remove(); });
    $$(".has-error", form).forEach(function (el) { el.classList.remove("has-error"); });
    var box = form.querySelector(".form-alert");
    if (box) box.remove();
    if (btn) btn.disabled = true;
    Promise.resolve()
      .then(function () { return handler(values, form); })
      .catch(function (err) { showFormError(form, err); })
      .then(function () { if (btn && document.body.contains(btn)) btn.disabled = false; });
  });
}

function showFormError(form, err) {
  var fields = (err.details && err.details.fields) || {};
  var placed = false;
  Object.keys(fields).forEach(function (name) {
    var wrap = form.querySelector('[data-field="' + name + '"]');
    if (!wrap) return;
    wrap.classList.add("has-error");
    var s = document.createElement("small");
    s.className = "field-error";
    s.textContent = fields[name];
    wrap.appendChild(s);
    placed = true;
  });
  if (!placed || err.code !== "validation_error") {
    var box = document.createElement("div");
    box.className = "alert error form-alert";
    box.textContent = err.message;
    form.insertBefore(box, form.firstChild);
  }
}

function fail(name, message) {
  var e = new Error(message);
  e.code = "validation_error";
  e.details = { fields: {} };
  e.details.fields[name] = message;
  return e;
}

/* ================================================================
   state & layout
   ================================================================ */

var state = {
  me: null,
  config: null,
  route: "/",
  query: new URLSearchParams(),
  mfaToken: null
};

function setTheme(next) {
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("fourtexec-theme", next); } catch (e) {}
}
function theme() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }

var ICON_SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
var ICON_MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
var ICON_OUT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>';

function renderHeader() {
  var me = state.me;
  var right = '<button class="icon-btn" id="theme-btn" aria-label="toggle theme">' +
    (theme() === "dark" ? ICON_SUN : ICON_MOON) + "</button>";
  if (me) {
    right = '<a class="who" href="#/">' + avatar(me, "s") + '<span class="who-name">' + esc(me.username) + "</span></a>" +
      right + '<button class="icon-btn" id="logout-btn" title="sign out" aria-label="sign out">' + ICON_OUT + "</button>";
  }
  $("#site-header").innerHTML =
    '<div class="wrap header-in">' +
      '<a class="brand" href="' + esc(CFG.site) + '">' +
        '<img class="logo-img" src="' + (theme() === "dark" ? "dlogo.png" : "logo.png") + '" alt="">' +
        '<span class="brand-name">fourtexec</span><span class="brand-sub">/ account</span></a>' +
      '<div class="header-actions">' + right + "</div>" +
    "</div>";
  $("#theme-btn").addEventListener("click", function () {
    setTheme(theme() === "dark" ? "light" : "dark");
    renderHeader();
  });
  var out = $("#logout-btn");
  if (out) out.addEventListener("click", logout);
}

function renderFooter() {
  $("#site-footer").innerHTML =
    '<div class="wrap"><span>fourtexec accounts</span>' +
    '<span><a href="' + esc(CFG.site) + '">~/ site</a> · <a href="' + esc(CFG.site) + '/tou.txt">terms</a> · ' +
    '<a href="' + esc(CFG.site) + '/pp.txt">privacy</a></span></div>';
}

function renderBanners() {
  var msg = state.config && state.config.maintenanceMessage;
  $("#banners").innerHTML = msg
    ? '<div class="banner warning"><div class="wrap">! ' + esc(msg) + "</div></div>"
    : "";
}

function logout() {
  api("POST", "/v1/auth/logout").catch(function () {}).then(function () {
    state.me = null;
    go("/login");
    toast("signed out");
  });
}

function go(path) {
  if (location.hash === "#" + path) route();
  else location.hash = path;
}

var SIDE = [
  { to: "/", label: "overview" },
  { to: "/profile", label: "profile" },
  { to: "/security", label: "security" },
  { to: "/apps", label: "apps" },
  { to: "/account", label: "account" }
];

function shell(active, inner) {
  var links = SIDE.map(function (s) {
    return '<a href="#' + s.to + '" class="' + (s.to === active ? "active" : "") + '">~/ ' + s.label + "</a>";
  }).join("");
  if (state.me && state.me.permissions.indexOf("admin.access") !== -1) {
    links += '<a href="' + esc(CFG.admin) + '">~/ admin ↗</a>';
  }
  return '<div class="wrap layout"><nav class="side">' + links + "</nav><div>" + inner + "</div></div>";
}

/* ================================================================
   guest pages
   ================================================================ */

function nextParam() {
  var n = state.query.get("next");
  return n ? "?next=" + encodeURIComponent(n) : "";
}

function afterLogin(user) {
  state.me = user;
  state.mfaToken = null;
  var next = safeNext(state.query.get("next"));
  if (next) { location.href = next; return; }
  go("/");
}

function loginPage() {
  if (state.mfaToken) return mfaPage();
  var reason = state.query.get("reason");
  return '<div class="wrap auth-box">' +
    '<p class="kicker">$ ssh you@fourtexec</p>' +
    '<h1 class="page-title">sign in</h1>' +
    '<p class="page-sub">one account for every fourtexec thing.</p>' +
    '<div class="card"><form id="login-form" novalidate>' +
      (reason === "expired" ? '<div class="alert warn">your session ended — sign in again.</div>' : "") +
      field("login", "email or username", { autocomplete: "username", required: true, autofocus: true }) +
      field("password", "password", { type: "password", autocomplete: "current-password", required: true }) +
      '<button class="btn btn-solid wide" type="submit">sign in</button>' +
      '<p class="center small"><a class="link" href="#/forgot">forgot password?</a></p>' +
    "</form></div>" +
    (state.config && state.config.registrationOpen === false
      ? '<p class="auth-foot">registration is closed right now.</p>'
      : '<p class="auth-foot">new here? <a href="#/register' + nextParam() + '">create an account</a></p>') +
  "</div>";
}

function bindLogin() {
  bindForm($("#login-form"), function (v) {
    return api("POST", "/v1/auth/login", { login: v.login, password: v.password }).then(function (res) {
      if (res.mfaRequired) {
        state.mfaToken = res.mfaToken;
        render();
        return;
      }
      afterLogin(res.user);
    });
  });
}

function mfaPage() {
  return '<div class="wrap auth-box">' +
    '<p class="kicker">$ 2fa --verify</p>' +
    '<h1 class="page-title">two-factor check</h1>' +
    '<p class="page-sub">enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>' +
    '<div class="card"><form id="mfa-form" novalidate>' +
      field("code", "code", { autocomplete: "one-time-code", inputmode: "text", required: true, autofocus: true, code: true, maxlength: 20 }) +
      '<button class="btn btn-solid wide" type="submit">verify</button>' +
      '<p class="center small"><a class="link" href="#" id="mfa-cancel">start over</a></p>' +
    "</form></div></div>";
}

function bindMfa() {
  bindForm($("#mfa-form"), function (v) {
    return api("POST", "/v1/auth/login/mfa", { mfaToken: state.mfaToken, code: v.code }).then(function (res) {
      afterLogin(res.user);
    }, function (err) {
      if (err.code === "mfa_expired") { state.mfaToken = null; render(); toast(err.message); return; }
      throw err;
    });
  });
  var cancel = $("#mfa-cancel");
  if (cancel) cancel.addEventListener("click", function (e) { e.preventDefault(); state.mfaToken = null; render(); });
}

function registerPage() {
  if (state.config && state.config.registrationOpen === false) {
    return '<div class="wrap auth-box"><h1 class="page-title">registration closed</h1>' +
      '<p class="page-sub">we are not taking new accounts right now. check back later.</p>' +
      '<a class="btn" href="#/login">← sign in</a></div>';
  }
  return '<div class="wrap auth-box">' +
    '<p class="kicker">$ useradd</p>' +
    '<h1 class="page-title">create account</h1>' +
    '<p class="page-sub">takes ten seconds. we only email you about your account.</p>' +
    '<div class="card"><form id="register-form" novalidate>' +
      field("email", "email", { type: "email", autocomplete: "email", required: true, autofocus: true }) +
      field("username", "username", { autocomplete: "username", required: true, maxlength: 24, hint: "3–24 characters: letters, digits, _" }) +
      field("password", "password", { type: "password", autocomplete: "new-password", required: true, hint: "8+ characters. a phrase beats symbols." }) +
      '<p class="small mut">by signing up you accept the <a class="link" href="' + esc(CFG.site) + '/tou.txt" target="_blank" rel="noreferrer">terms</a> and <a class="link" href="' + esc(CFG.site) + '/pp.txt" target="_blank" rel="noreferrer">privacy policy</a>.</p>' +
      '<button class="btn btn-solid wide" type="submit">create account</button>' +
    "</form></div>" +
    '<p class="auth-foot">have an account? <a href="#/login' + nextParam() + '">sign in</a></p>' +
  "</div>";
}

function bindRegister() {
  bindForm($("#register-form"), function (v) {
    return api("POST", "/v1/auth/register", { email: v.email, username: v.username, password: v.password }).then(function (res) {
      if (res.verificationRequired) {
        $("#app").innerHTML = '<div class="wrap auth-box"><h1 class="page-title">check your inbox</h1>' +
          '<p class="page-sub">we sent a confirmation link to <b>' + esc(res.user.email) + '</b>. open it, then sign in.</p>' +
          '<a class="btn" href="#/login">→ sign in</a></div>';
        return;
      }
      toast("welcome aboard, " + res.user.username);
      afterLogin(res.user);
    });
  });
}

function forgotPage() {
  return '<div class="wrap auth-box">' +
    '<p class="kicker">$ passwd --reset</p>' +
    '<h1 class="page-title">forgot password</h1>' +
    '<p class="page-sub">we will email you a link to pick a new one.</p>' +
    '<div class="card" id="forgot-card"><form id="forgot-form" novalidate>' +
      field("email", "email", { type: "email", autocomplete: "email", required: true, autofocus: true }) +
      '<button class="btn btn-solid wide" type="submit">send reset link</button>' +
    "</form></div>" +
    '<p class="auth-foot"><a href="#/login">← back to sign in</a></p></div>';
}

function bindForgot() {
  bindForm($("#forgot-form"), function (v) {
    return api("POST", "/v1/auth/password/forgot", { email: v.email }).then(function () {
      $("#forgot-card").innerHTML = '<div class="alert ok">if an account uses <b>' + esc(v.email) +
        "</b>, a reset link is on its way. it works for one hour.</div>";
    });
  });
}

function resetPage() {
  if (!state.query.get("token")) {
    return '<div class="wrap auth-box"><div class="alert error">this reset link is broken — request a new one.</div>' +
      '<a class="btn" href="#/forgot">→ new link</a></div>';
  }
  return '<div class="wrap auth-box">' +
    '<p class="kicker">$ passwd</p>' +
    '<h1 class="page-title">new password</h1>' +
    '<p class="page-sub">this signs you out on every device.</p>' +
    '<div class="card" id="reset-card"><form id="reset-form" novalidate>' +
      field("password", "new password", { type: "password", autocomplete: "new-password", required: true, autofocus: true }) +
      field("confirm", "repeat it", { type: "password", autocomplete: "new-password", required: true }) +
      '<button class="btn btn-solid wide" type="submit">set password</button>' +
    "</form></div></div>";
}

function bindReset() {
  bindForm($("#reset-form"), function (v) {
    if (v.password !== v.confirm) throw fail("confirm", "Passwords don't match");
    return api("POST", "/v1/auth/password/reset", { token: state.query.get("token"), password: v.password }).then(function () {
      state.me = null;
      $("#reset-card").innerHTML = '<div class="alert ok">password changed. sign in with the new one.</div>' +
        '<a class="btn btn-solid wide" href="#/login">sign in</a>';
    });
  });
}

function verifyPage() {
  return '<div class="wrap auth-box"><p class="kicker">$ verify --email</p>' +
    '<h1 class="page-title">confirming…</h1><div id="verify-box" class="spinner">working</div></div>';
}

function bindVerify() {
  var token = state.query.get("token");
  var box = $("#verify-box");
  if (!token) { box.className = "alert error"; box.textContent = "this link is broken."; return; }
  api("POST", "/v1/auth/verify-email", { token: token }).then(function (res) {
    if (state.me) state.me = res.user;
    $(".page-title").textContent = "done";
    box.className = "";
    box.innerHTML = '<div class="alert ok">' + (res.kind === "email_change"
      ? "your email is now <b>" + esc(res.user.email) + "</b>."
      : "email confirmed. thanks!") + "</div>" +
      '<a class="btn btn-solid" href="#/">→ my account</a>';
  }, function (err) {
    $(".page-title").textContent = "hmm";
    box.className = "alert error";
    box.textContent = err.message;
  });
}

/* ================================================================
   signed-in pages
   ================================================================ */

function overviewPage() {
  var me = state.me;
  var verify = me.emailVerified ? "" :
    '<div class="alert warn">your email isn\'t confirmed yet. ' +
    '<a class="link" href="#" id="resend-link">send the link again</a></div>';
  return shell("/",
    verify +
    '<div class="card">' +
      '<div class="profile-head">' + avatar(me, "l") +
        "<div><h1>" + esc(me.displayName) + "</h1>" +
        '<div class="handle">@' + esc(me.username) + " " + roleChip(me.role) + "</div></div></div>" +
      (me.bio ? '<p class="bio">' + esc(me.bio) + "</p>" : "") +
    "</div>" +
    '<div class="card"><h2>at a glance</h2><dl class="kv">' +
      "<dt>email</dt><dd>" + esc(me.email) + " " + (me.emailVerified ? '<span class="chip ok">confirmed</span>' : '<span class="chip bad">unconfirmed</span>') + "</dd>" +
      "<dt>2fa</dt><dd>" + (me.twoFactorEnabled ? '<span class="chip ok">on</span>' : '<span class="chip">off</span> <a class="link small" href="#/security">turn on</a>') + "</dd>" +
      "<dt>password</dt><dd>changed " + esc(ago(me.passwordChangedAt)) + "</dd>" +
      "<dt>member since</dt><dd>" + esc(fmtDate(me.createdAt)) + "</dd>" +
      '<dt>public page</dt><dd><a class="link" href="#/u/' + esc(me.username) + '">#/u/' + esc(me.username) + "</a></dd>" +
    "</dl>" +
    '<div class="tiles">' +
      '<a class="tile" href="#/profile"><b>~/ profile</b><span>name, avatar, bio</span></a>' +
      '<a class="tile" href="#/security"><b>~/ security</b><span>password, 2fa, devices</span></a>' +
      '<a class="tile" href="#/account"><b>~/ account</b><span>email, activity, delete</span></a>' +
    "</div></div>");
}

function bindOverview() {
  var link = $("#resend-link");
  if (link) link.addEventListener("click", function (e) {
    e.preventDefault();
    api("POST", "/v1/auth/verify-email/resend", {}).then(function () { toast("sent — check your inbox"); }, function (err) { toast(err.message); });
  });
}

function profilePage() {
  var me = state.me;
  return shell("/profile",
    '<h1 class="page-title">profile</h1><p class="page-sub">what other people see.</p>' +
    '<div class="card"><form id="profile-form" novalidate>' +
      '<div class="profile-head" id="avatar-preview">' + avatar(me, "m") + "</div><br>" +
      '<div class="form-grid two">' +
        field("displayName", "display name", { value: me.displayName, maxlength: 48, required: true }) +
        field("username", "username", { value: me.username, maxlength: 24, required: true, hint: "letters, digits, _" }) +
      "</div>" +
      field("avatarUrl", "avatar url", { type: "url", value: me.avatarUrl || "", placeholder: "https://…", hint: "an https:// link to a square image. empty = letter tile." }) +
      field("bio", "bio", { type: "textarea", value: me.bio, maxlength: 500 }) +
      '<button class="btn btn-solid" type="submit">save</button>' +
    "</form></div>");
}

function bindProfile() {
  var form = $("#profile-form");
  var urlInput = $("#f-avatarUrl");
  urlInput.addEventListener("change", function () {
    $("#avatar-preview").innerHTML = avatar({ displayName: $("#f-displayName").value, avatarUrl: urlInput.value.trim() }, "m");
    hookImages($("#avatar-preview"));
  });
  bindForm(form, function (v) {
    return api("PATCH", "/v1/me", {
      displayName: v.displayName, username: v.username, bio: v.bio, avatarUrl: v.avatarUrl.trim()
    }).then(function (res) {
      state.me = res.user;
      renderHeader();
      toast("saved");
    });
  });
}

function securityPage() {
  return shell("/security",
    '<h1 class="page-title">security</h1><p class="page-sub">password, two-factor auth and signed-in devices.</p>' +
    '<div class="card"><h2>password</h2><p class="lead">changing it signs out every other device.</p>' +
      '<form id="password-form" novalidate>' +
        '<input type="text" name="username" autocomplete="username" value="' + esc(state.me.email) + '" class="hidden" tabindex="-1" aria-hidden="true">' +
        field("currentPassword", "current password", { type: "password", autocomplete: "current-password", required: true }) +
        '<div class="form-grid two">' +
          field("newPassword", "new password", { type: "password", autocomplete: "new-password", required: true }) +
          field("confirm", "repeat new password", { type: "password", autocomplete: "new-password", required: true }) +
        "</div>" +
        '<button class="btn btn-solid" type="submit">change password</button>' +
      "</form></div>" +
    '<div class="card" id="twofa-card"><h2>two-factor auth</h2><div class="spinner">loading</div></div>' +
    '<div class="card" id="sessions-card"><h2>devices</h2><div class="spinner">loading</div></div>');
}

function bindSecurity() {
  bindForm($("#password-form"), function (v, form) {
    if (v.newPassword !== v.confirm) throw fail("confirm", "Passwords don't match");
    return api("POST", "/v1/me/password", { currentPassword: v.currentPassword, newPassword: v.newPassword }).then(function (res) {
      form.reset();
      toast("password changed" + (res.sessionsRevoked ? " · " + res.sessionsRevoked + " other session(s) signed out" : ""));
      loadSessions();
    });
  });
  loadTwoFa();
  loadSessions();
}

function codesBlock(codes) {
  return '<div class="alert warn">save these recovery codes somewhere safe. each works once if you lose your phone. ' +
    "you won't see them again.</div>" +
    '<div class="codes">' + codes.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + "</div>" +
    '<div class="btn-row"><button class="btn btn-sm" id="codes-copy" type="button">copy</button>' +
    '<button class="btn btn-sm" id="codes-dl" type="button">download .txt</button>' +
    '<button class="btn btn-sm btn-solid" id="codes-done" type="button">i saved them</button></div>';
}

function bindCodes(codes) {
  var text = "fourtexec recovery codes for " + state.me.username + "\n\n" + codes.join("\n") + "\n";
  $("#codes-copy").addEventListener("click", function () { copy(codes.join("\n")); });
  $("#codes-dl").addEventListener("click", function () { download("fourtexec-recovery-codes.txt", text); });
  $("#codes-done").addEventListener("click", loadTwoFa);
}

function loadTwoFa() {
  var card = $("#twofa-card");
  if (!card) return;
  api("GET", "/v1/me/2fa").then(function (s) {
    if (!s.enabled) {
      card.innerHTML = "<h2>two-factor auth <span class=\"chip\">off</span></h2>" +
        '<p class="lead">add a 6-digit code from an authenticator app (aegis, google authenticator, 1password…) on top of your password.</p>' +
        '<form id="twofa-start" novalidate>' +
          field("password", "confirm with your password", { type: "password", autocomplete: "current-password", required: true }) +
          '<button class="btn btn-solid" type="submit">set up 2fa</button></form>';
      bindForm($("#twofa-start"), function (v) {
        return api("POST", "/v1/me/2fa/setup", { password: v.password }).then(showTwoFaSetup);
      });
      return;
    }
    card.innerHTML = '<h2>two-factor auth <span class="chip ok">on</span></h2>' +
      '<p class="lead">on since ' + esc(fmtDate(s.enabledAt)) + " · " + s.recoveryCodesLeft + " recovery code(s) left.</p>" +
      '<form id="twofa-manage" novalidate><div class="form-grid two">' +
        field("password", "password", { type: "password", autocomplete: "current-password", required: true }) +
        field("code", "code from the app", { autocomplete: "one-time-code", required: true, maxlength: 20 }) +
      '</div><div class="btn-row">' +
        '<button class="btn" type="submit" data-action="codes">new recovery codes</button>' +
        '<button class="btn btn-danger" type="submit" data-action="disable">turn off 2fa</button>' +
      "</div></form>";
    var action = "codes";
    $$("#twofa-manage button[data-action]").forEach(function (b) {
      b.addEventListener("click", function () { action = b.getAttribute("data-action"); });
    });
    bindForm($("#twofa-manage"), function (v) {
      if (action === "disable") {
        if (!confirm("turn off two-factor auth? your account will be protected by the password only.")) return;
        return api("POST", "/v1/me/2fa/disable", { password: v.password, code: v.code }).then(function () {
          state.me.twoFactorEnabled = false;
          toast("2fa is off");
          loadTwoFa();
        });
      }
      return api("POST", "/v1/me/2fa/recovery-codes", { password: v.password, code: v.code }).then(function (res) {
        card.innerHTML = "<h2>new recovery codes</h2>" + codesBlock(res.recoveryCodes);
        bindCodes(res.recoveryCodes);
      });
    });
  }, function (err) { card.innerHTML = '<div class="alert error">' + esc(err.message) + "</div>"; });
}

function qrSvg(text) {
  try {
    var qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) {
    return "";
  }
}

function showTwoFaSetup(res) {
  var card = $("#twofa-card");
  card.innerHTML = "<h2>scan this</h2>" +
    '<p class="lead">scan the code with your authenticator app, then type the 6 digits it shows.</p>' +
    '<div class="setup-grid"><div class="qr">' + qrSvg(res.otpauthUrl) + "</div>" +
    '<div><p class="small mut">can\'t scan? enter this key by hand:</p><div class="secret">' + esc(res.secret.replace(/(.{4})/g, "$1 ").trim()) + "</div><br>" +
    '<form id="twofa-enable" novalidate>' +
      field("code", "6-digit code", { autocomplete: "one-time-code", inputmode: "numeric", maxlength: 6, required: true, code: true, autofocus: true }) +
      '<div class="btn-row"><button class="btn btn-solid" type="submit">turn on</button>' +
      '<button class="btn" type="button" id="twofa-cancel">cancel</button></div>' +
    "</form></div></div>";
  $("#twofa-cancel").addEventListener("click", loadTwoFa);
  bindForm($("#twofa-enable"), function (v) {
    return api("POST", "/v1/me/2fa/enable", { code: v.code }).then(function (r) {
      state.me.twoFactorEnabled = true;
      card.innerHTML = "<h2>2fa is on ✓</h2>" + codesBlock(r.recoveryCodes);
      bindCodes(r.recoveryCodes);
    });
  });
}

function loadSessions() {
  var card = $("#sessions-card");
  if (!card) return;
  api("GET", "/v1/me/sessions").then(function (res) {
    var items = res.sessions.map(function (s) {
      return '<li><div class="main"><div class="title">' + esc(describeUA(s.userAgent)) +
        (s.current ? ' <span class="chip ok">this device</span>' : "") + "</div>" +
        '<div class="meta">' + esc(s.ip || "?") + " · active " + esc(ago(s.lastSeenAt)) + " · since " + esc(fmtDate(s.createdAt)) + "</div></div>" +
        (s.current ? "" : '<button class="btn btn-sm" data-revoke="' + esc(s.id) + '">sign out</button>') + "</li>";
    }).join("");
    card.innerHTML = '<h2>devices</h2><p class="lead">everywhere you are signed in right now.</p>' +
      '<ul class="rows">' + items + "</ul>" +
      (res.sessions.length > 1 ? '<br><button class="btn btn-danger" id="revoke-others">sign out everywhere else</button>' : "");
    $$("[data-revoke]", card).forEach(function (b) {
      b.addEventListener("click", function () {
        b.disabled = true;
        api("DELETE", "/v1/me/sessions/" + encodeURIComponent(b.getAttribute("data-revoke"))).then(loadSessions, function (err) { toast(err.message); b.disabled = false; });
      });
    });
    var all = $("#revoke-others");
    if (all) all.addEventListener("click", function () {
      api("POST", "/v1/me/sessions/revoke-others").then(function (r) { toast(r.revoked + " session(s) signed out"); loadSessions(); });
    });
  }, function (err) { card.innerHTML = '<div class="alert error">' + esc(err.message) + "</div>"; });
}

var ACTIONS = {
  "auth.register": "account created",
  "auth.login": "signed in",
  "auth.login_failed": "failed sign-in attempt",
  "auth.logout": "signed out",
  "auth.password_reset_requested": "password reset requested",
  "auth.password_reset": "password reset by email",
  "auth.reauth_failed": "wrong password on a protected action",
  "user.email_verified": "email confirmed",
  "user.email_change_requested": "email change requested",
  "user.email_changed": "email changed",
  "user.profile_updated": "profile updated",
  "user.password_changed": "password changed",
  "user.session_revoked": "device signed out",
  "user.sessions_revoked": "other devices signed out",
  "user.2fa_enabled": "2fa turned on",
  "user.2fa_disabled": "2fa turned off",
  "user.recovery_codes_regenerated": "new recovery codes",
  "admin.user_updated": "profile edited by staff",
  "admin.role_changed": "role changed by staff",
  "admin.user_banned": "banned by staff",
  "admin.user_unbanned": "unbanned by staff",
  "admin.sessions_revoked": "signed out by staff",
  "admin.session_revoked": "device signed out by staff",
  "admin.2fa_disabled": "2fa turned off by staff",
  "admin.password_reset_sent": "staff sent a password reset",
  "admin.verification_sent": "staff resent confirmation email",
  "oauth.authorized": "signed in to an app",
  "oauth.denied": "declined an app",
  "oauth.access_revoked": "disconnected an app"
};

function describeAction(item, myId) {
  var label = ACTIONS[item.action] || item.action;
  if (item.action === "admin.role_changed" && item.meta) label += " (" + item.meta.from + " → " + item.meta.to + ")";
  if (item.action.indexOf("oauth.") === 0 && item.target) label += ": " + item.target.label;
  if (item.actor && item.actor.id !== myId && item.action.indexOf("admin.") === 0) label += " · " + item.actor.username;
  return label;
}

function accountPage() {
  var me = state.me;
  return shell("/account",
    '<h1 class="page-title">account</h1><p class="page-sub">email, history and the red button.</p>' +
    '<div class="card"><h2>email</h2><p class="lead">now: <b>' + esc(me.email) + "</b>. we send a link to the new address — the change happens when you open it.</p>" +
      '<form id="email-form" novalidate><div class="form-grid two">' +
        field("email", "new email", { type: "email", autocomplete: "email", required: true }) +
        field("password", "password", { type: "password", autocomplete: "current-password", required: true }) +
      '</div><button class="btn btn-solid" type="submit">send confirmation</button></form></div>' +
    '<div class="card" id="activity-card"><h2>recent activity</h2><div class="spinner">loading</div></div>' +
    '<div class="card danger"><h2>delete account</h2>' +
      '<p class="lead">gone for good: profile, sessions, everything tied to it. there is no undo.</p>' +
      '<form id="delete-form" novalidate>' +
        field("confirmName", "type your username (" + me.username + ") to confirm", { required: true, autocomplete: "off" }) +
        '<div class="form-grid two">' +
          field("password", "password", { type: "password", autocomplete: "current-password", required: true }) +
          (me.twoFactorEnabled ? field("code", "2fa code", { autocomplete: "one-time-code", required: true, maxlength: 20 }) : "") +
        "</div>" +
        '<button class="btn btn-danger" type="submit">delete my account</button>' +
      "</form></div>");
}

function bindAccount() {
  bindForm($("#email-form"), function (v, form) {
    return api("POST", "/v1/me/email", { email: v.email, password: v.password }).then(function (res) {
      form.reset();
      toast("link sent to " + res.pendingEmail);
    });
  });
  bindForm($("#delete-form"), function (v) {
    if (v.confirmName.trim().toLowerCase() !== state.me.username.toLowerCase()) throw fail("confirmName", "That's not your username");
    var data = { password: v.password };
    if (v.code) data.code = v.code;
    return api("DELETE", "/v1/me", data).then(function () {
      state.me = null;
      $("#app").innerHTML = '<div class="wrap auth-box"><h1 class="page-title">account deleted</h1>' +
        '<p class="page-sub">sorry to see you go. the door stays open.</p><a class="btn" href="' + esc(CFG.site) + '">→ fourtexec.site</a></div>';
      renderHeader();
    });
  });
  api("GET", "/v1/me/activity").then(function (res) {
    var card = $("#activity-card");
    if (!card) return;
    var items = res.items.map(function (i) {
      var bad = /failed|banned/.test(i.action);
      return '<li><div class="main"><div class="title' + (bad ? " acc" : "") + '">' + esc(describeAction(i, state.me.id)) + "</div>" +
        '<div class="meta">' + esc(fmtDate(i.createdAt, true)) + (i.ip ? " · " + esc(i.ip) : "") + "</div></div></li>";
    }).join("");
    card.innerHTML = '<h2>recent activity</h2><p class="lead">sign-ins and changes to your account. something you don\'t recognise? change your password.</p>' +
      (items ? '<ul class="rows">' + items + "</ul>" : '<p class="mut">nothing yet.</p>');
  });
}

/* ================================================================
   sign in with fourtexec (oauth consent) & connected apps
   ================================================================ */

function appLogo(app, size) {
  var letter = esc((app.name || "?").trim().charAt(0).toUpperCase());
  var img = app.logoUrl ? '<img src="' + esc(app.logoUrl) + '" alt="" referrerpolicy="no-referrer" data-hide-on-error>' : "";
  return '<span class="avatar ' + size + '">' + letter + img + "</span>";
}

var OAUTH_ERRORS = {
  invalid_client: "this app isn't registered with fourtexec, or it has been switched off.",
  invalid_redirect_uri: "the app tried to send you to an address it never registered. that can be a sign of phishing, so we stopped here."
};

function authorizePage() {
  var err = state.query.get("error");
  if (err) {
    return '<div class="wrap auth-box"><p class="kicker">$ oauth --authorize</p><h1 class="page-title">can\'t sign you in</h1>' +
      '<div class="alert error">' + esc(OAUTH_ERRORS[err] || state.query.get("error_description") || err) + "</div>" +
      '<p class="page-sub small">go back to the app and try again. if it keeps happening, tell the app\'s developers.</p>' +
      '<a class="btn" href="#/">→ my account</a></div>';
  }
  return '<div class="wrap auth-box"><p class="kicker">$ oauth --authorize</p><div id="consent" class="spinner">loading</div></div>';
}

function bindAuthorize() {
  var id = state.query.get("request");
  var box = $("#consent");
  if (!box) return;
  if (!id) { box.className = "alert error"; box.textContent = "this link is broken — go back to the app and try again."; return; }

  function decide(approve) {
    return api("POST", "/v1/oauth/requests/" + encodeURIComponent(id), { approve: approve }).then(function (res) {
      box.className = "spinner";
      box.innerHTML = approve ? "signing you in" : "going back";
      location.href = res.redirectTo;
    });
  }

  api("GET", "/v1/oauth/requests/" + encodeURIComponent(id)).then(function (info) {
    var app = info.client;
    if (info.alreadyGranted || app.trusted) {
      box.textContent = "signing you in to " + app.name;
      return decide(true);
    }
    var me = state.me;
    box.className = "";
    box.innerHTML = '<div class="card consent">' +
      '<div class="profile-head">' + appLogo(app, "m") + "<div><h1>" + esc(app.name) + "</h1>" +
        '<div class="handle">wants to use your fourtexec account</div></div></div>' +
      (app.description ? '<p class="bio">' + esc(app.description) + "</p>" : "") +
      '<div class="signed-as">' + avatar(me, "s") + "<span>signed in as <b>@" + esc(me.username) + '</b></span> <a class="link small" href="#" id="switch-user">not you?</a></div>' +
      '<p class="kicker">this will let ' + esc(app.name) + ":</p>" +
      '<ul class="scope-list">' + info.scopes.map(function (s) { return "<li>" + esc(s.description) + "</li>"; }).join("") + "</ul>" +
      '<p class="small mut">after you allow, you go to <b class="mono">' + esc(info.redirectHost) + "</b>" +
        (app.homepageUrl ? ' · <a class="link" href="' + esc(app.homepageUrl) + '" target="_blank" rel="noreferrer">about the app</a>' : "") +
        ". you can disconnect it any time in <b>~/ apps</b>.</p>" +
      '<div class="btn-row"><button class="btn btn-solid" id="allow">allow</button><button class="btn" id="deny">cancel</button></div>' +
    "</div>";
    hookImages(box);
    var allow = $("#allow"), deny = $("#deny");
    [allow, deny].forEach(function (b) {
      b.addEventListener("click", function () {
        allow.disabled = deny.disabled = true;
        decide(b === allow).catch(function (err) { toast(err.message); allow.disabled = deny.disabled = false; });
      });
    });
    $("#switch-user").addEventListener("click", function (e) {
      e.preventDefault();
      var back = location.href;
      api("POST", "/v1/auth/logout").catch(function () {}).then(function () {
        state.me = null;
        location.hash = "/login?next=" + encodeURIComponent(back);
      });
    });
  }, function (err) {
    box.className = "alert error";
    box.textContent = err.message;
  });
}

function appsPage() {
  return shell("/apps",
    '<h1 class="page-title">apps</h1><p class="page-sub">apps you signed in to with your fourtexec account.</p>' +
    '<div class="card" id="apps-card"><div class="spinner">loading</div></div>');
}

function bindApps() {
  var card = $("#apps-card");
  api("GET", "/v1/me/apps").then(function (res) {
    if (!res.items.length) {
      card.innerHTML = '<p class="mut">nothing connected yet. when an app offers “sign in with fourtexec”, it shows up here.</p>';
      return;
    }
    card.innerHTML = '<ul class="rows">' + res.items.map(function (a) {
      return '<li><div class="main app-row">' + appLogo(a, "s") + "<div>" +
        '<div class="title">' + (a.homepageUrl ? '<a class="link" href="' + esc(a.homepageUrl) + '" target="_blank" rel="noreferrer">' + esc(a.name) + "</a>" : esc(a.name)) +
          (a.disabled ? ' <span class="chip">switched off</span>' : "") + "</div>" +
        '<div class="meta">can ' + esc(a.scopes.map(scopeShort).join(", ")) + "</div>" +
        '<div class="meta">connected ' + esc(fmtDate(a.grantedAt)) + " · last used " + esc(ago(a.lastUsedAt)) + "</div></div></div>" +
        '<button class="btn btn-sm btn-danger" data-disconnect="' + esc(a.clientId) + '" data-name="' + esc(a.name) + '">disconnect</button></li>';
    }).join("") + "</ul>";
    hookImages(card);
    $$("[data-disconnect]", card).forEach(function (b) {
      b.addEventListener("click", function () {
        if (!confirm("disconnect " + b.getAttribute("data-name") + "? it gets signed out and has to ask again next time.")) return;
        b.disabled = true;
        api("DELETE", "/v1/me/apps/" + encodeURIComponent(b.getAttribute("data-disconnect"))).then(function () {
          toast("disconnected");
          bindApps();
        }, function (err) { toast(err.message); b.disabled = false; });
      });
    });
  }, function (err) { card.innerHTML = '<div class="alert error">' + esc(err.message) + "</div>"; });
}

function scopeShort(s) {
  return { openid: "sign you in", profile: "see your profile", email: "see your email", offline_access: "stay signed in" }[s] || s;
}

function publicProfilePage(username) {
  return '<div class="wrap"><div id="pub" class="spinner">loading</div></div>';
}

function bindPublicProfile(username) {
  api("GET", "/v1/public/users/" + encodeURIComponent(username)).then(function (res) {
    var u = res.user;
    $("#pub").className = "";
    $("#pub").innerHTML = '<div class="card">' +
      '<div class="profile-head">' + avatar(u, "l") +
        "<div><h1>" + esc(u.displayName) + "</h1>" +
        '<div class="handle">@' + esc(u.username) + " " + roleChip(u.role) + "</div>" +
        '<div class="handle">joined ' + esc(fmtDate(u.createdAt)) + "</div></div></div>" +
      (u.bio ? '<p class="bio">' + esc(u.bio) + "</p>" : "") + "</div>";
    hookImages($("#pub"));
    document.title = u.displayName + " · fourtexec";
  }, function (err) {
    $("#pub").className = "";
    $("#pub").innerHTML = '<div class="alert error">' + esc(err.status === 404 ? "no user called @" + username : err.message) + "</div>";
  });
}

function notFoundPage() {
  return '<div class="wrap auth-box"><h1 class="page-title">404</h1><p class="page-sub">no such page.</p>' +
    '<a class="btn" href="#/">→ home</a></div>';
}

/* ================================================================
   routing
   ================================================================ */

var ROUTES = {
  "/login": { page: loginPage, bind: function () { bindLogin(); bindMfa(); }, guest: true },
  "/register": { page: registerPage, bind: bindRegister, guest: true },
  "/forgot": { page: forgotPage, bind: bindForgot },
  "/reset": { page: resetPage, bind: bindReset },
  "/verify": { page: verifyPage, bind: bindVerify },
  "/": { page: overviewPage, bind: bindOverview, auth: true },
  "/profile": { page: profilePage, bind: bindProfile, auth: true },
  "/security": { page: securityPage, bind: bindSecurity, auth: true },
  "/account": { page: accountPage, bind: bindAccount, auth: true },
  "/apps": { page: appsPage, bind: bindApps, auth: true },
  // auth only when there is a request to approve; error links work signed out
  "/authorize": { page: authorizePage, bind: bindAuthorize, auth: function () { return !state.query.get("error"); } }
};

function parseHash() {
  var h = location.hash.replace(/^#/, "") || "/";
  var qi = h.indexOf("?");
  state.route = (qi === -1 ? h : h.slice(0, qi)).replace(/\/+$/, "") || "/";
  state.query = new URLSearchParams(qi === -1 ? "" : h.slice(qi + 1));
}

// images that fail to load are hidden so the letter tile shows through
function hookImages(root) {
  $$("img[data-hide-on-error]", root).forEach(function (img) {
    img.addEventListener("error", function () { img.remove(); });
  });
}

function render() {
  var app = $("#app");
  var r = ROUTES[state.route];
  var pub = /^\/u\/([A-Za-z0-9_]{1,32})$/.exec(state.route);

  renderHeader();
  renderBanners();

  if (pub) {
    app.innerHTML = publicProfilePage(pub[1]);
    bindPublicProfile(pub[1]);
  } else if (!r) {
    app.innerHTML = notFoundPage();
  } else if ((typeof r.auth === "function" ? r.auth() : r.auth) && !state.me) {
    location.replace("#/login?next=" + encodeURIComponent(location.href));
    return;
  } else if (r.guest && state.me) {
    var next = safeNext(state.query.get("next"));
    if (next) { location.href = next; return; }
    location.replace("#/");
    return;
  } else {
    app.innerHTML = r.page();
    if (r.bind) r.bind();
  }
  hookImages(document);
  var focus = $("[autofocus]", app);
  if (focus) focus.focus();
}

function route() {
  parseHash();
  render();
  window.scrollTo(0, 0);
}

function boot() {
  // refuse to run inside a frame: a hidden "allow" button is a classic trick
  if (window.top !== window.self) {
    document.body.innerHTML = "";
    try { window.top.location = window.location.href; } catch (e) {}
    return;
  }
  renderFooter();
  Promise.all([
    api("GET", "/v1/me").then(function (r) { return r.user; }, function (err) {
      if (err.status === 401) return null;
      throw err;
    }),
    api("GET", "/v1/public/config").catch(function () { return null; })
  ]).then(function (res) {
    state.me = res[0];
    state.config = res[1];
    route();
  }, function (err) {
    renderHeader();
    $("#app").innerHTML = '<div class="wrap auth-box"><h1 class="page-title">offline</h1>' +
      '<div class="alert error">' + esc(err.message) + '</div><button class="btn" id="retry">retry</button></div>';
    $("#retry").addEventListener("click", function () { location.reload(); });
  });
  window.addEventListener("hashchange", route);
}

boot();
