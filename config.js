// where the pieces live. on localhost everything points at local dev servers:
//   api :8080 · site :8000 · accounts :8001 · admin :8002
(function () {
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  window.FTX_CONFIG = local
    ? {
        api: "http://" + location.hostname + ":8080",
        site: "http://" + location.hostname + ":8000",
        accounts: "http://" + location.hostname + ":8001",
        admin: "http://" + location.hostname + ":8002"
      }
    : {
        api: "https://api.fourtexec.site",
        site: "https://fourtexec.site",
        accounts: "https://accounts.fourtexec.site",
        admin: "https://admin.fourtexec.site"
      };
})();
