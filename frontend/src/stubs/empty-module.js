// Server-side stub: replaces browser-only packages during Next.js build
// Real implementations are loaded only in the browser
module.exports = new Proxy(
  {},
  {
    get: (_, prop) => {
      if (prop === '__esModule') return true;
      if (prop === 'default') return {};
      return () => {};
    },
    construct: () => ({}),
  }
);
