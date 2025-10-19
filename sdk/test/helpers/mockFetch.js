'use strict';

class MockFetch {
  constructor() {
    this.routes = new Map();
    this.calls = [];
  }

  respond(method, path, handler) {
    const key = this._key(method, path);
    const value = Array.isArray(handler) ? handler.slice() : handler;
    this.routes.set(key, value);
  }

  respondSequence(method, path, handlers) {
    this.respond(method, path, handlers);
  }

  _key(method, path) {
    return `${method.toUpperCase()} ${path}`;
  }

  async fetch(input, init = {}) {
    const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
    const method = (init.method || 'GET').toUpperCase();
    const key = this._key(method, url.pathname);

    const route = this.routes.get(key);
    let handler = route;
    if (Array.isArray(route)) {
      if (route.length === 0) {
        throw new Error(`No more mock responses configured for ${method} ${url.pathname}`);
      }
      handler = route.shift();
      this.routes.set(key, route);
    }

    if (!handler) {
      throw new Error(`No mock response configured for ${method} ${url.pathname}`);
    }

    const headersInstance = new Headers(init.headers || {});
    const headers = {};
    headersInstance.forEach((value, headerName) => {
      headers[headerName.toLowerCase()] = value;
    });

    let body = undefined;
    if (init.body) {
      try {
        body = JSON.parse(init.body);
      } catch (error) {
        body = init.body;
      }
    }

    const context = { url, init, headers, body, method };
    const responseConfig = typeof handler === 'function' ? handler(context, this) : handler;
    const status = responseConfig.status || 200;
    const responseHeaders = responseConfig.headers || { 'content-type': 'application/json' };
    const responseBody = responseConfig.body !== undefined ? responseConfig.body : {};
    const serializedBody = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);

    this.calls.push({
      method,
      url: url.toString(),
      path: url.pathname,
      headers,
      body,
      status,
    });

    return new Response(serializedBody, { status, headers: responseHeaders });
  }
}

module.exports = MockFetch;
module.exports.createMockFetch = () => {
  const mock = new MockFetch();
  return { mock, fetch: mock.fetch.bind(mock) };
};
