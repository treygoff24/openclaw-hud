const {
  isLoopbackOrigin,
  isTailscaleOrigin,
  isLoopbackRemoteAddress,
} = require("../ws-origin-guard");

function createRequireLocalOrigin({ errorMessage = "Forbidden origin" } = {}) {
  return function requireLocalOrigin(req, res, next) {
    const origin = req?.headers?.origin;
    if (origin && !isLoopbackOrigin(origin)) {
      if (isTailscaleOrigin(origin) && isLoopbackRemoteAddress(req?.socket?.remoteAddress)) {
        return next();
      }
      return res.status(403).json({ error: errorMessage });
    }
    return next();
  };
}

const requireLocalOrigin = createRequireLocalOrigin();

module.exports = {
  createRequireLocalOrigin,
  requireLocalOrigin,
};
