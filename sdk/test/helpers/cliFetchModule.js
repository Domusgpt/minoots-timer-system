'use strict';

const MockFetch = require('./mockFetch');

const mock = new MockFetch();

async function fetchProxy(input, init) {
  return mock.fetch(input, init);
}

fetchProxy.mock = mock;

module.exports = fetchProxy;
