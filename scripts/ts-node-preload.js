const Module = require('module');
const path = require('path');

const additionalPaths = [
  path.resolve(__dirname, '../apps/control-plane/node_modules'),
  path.resolve(__dirname, '../node_modules'),
];

process.env.NODE_PATH = additionalPaths.join(path.delimiter);
Module._initPaths();

const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(id, ...rest) {
  const exports = originalRequire.call(this, id, ...rest);
  if (id === '@grpc/proto-loader' && exports && !('default' in exports)) {
    exports.default = exports;
  }
  if (id === '@grpc/grpc-js' && exports && !('default' in exports)) {
    exports.default = exports;
  }
  return exports;
};
