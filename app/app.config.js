// Expo dynamic config: extends app.json and injects the API base URL from the
// build-time env var EXPO_PUBLIC_API_URL.
//   - unset            → dev default (http://localhost:3000 on web / LAN IP on native)
//   - "" (empty)       → same-origin: the web build calls a relative "/api" (nginx proxies it)
//   - "https://api...” → absolute API origin (e.g. separate API domain / native builds)
const base = require('./app.json');

module.exports = () => {
  const cfg = { ...base.expo };
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  cfg.extra = { ...(cfg.extra || {}) };
  if (apiUrl !== undefined) cfg.extra.apiUrl = apiUrl;
  return cfg;
};
