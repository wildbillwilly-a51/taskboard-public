// These tests render markup in Node, where Next's CSS loader is unavailable.
// Keep CSS module class names readable for markup assertions.
require.extensions[".css"] = (stylesheet, filename) => {
  stylesheet.exports = filename.endsWith(".module.css")
    ? new Proxy({}, {
        get: (_target, name) => name === "__esModule" ? undefined : name,
      })
    : {};
};
