'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

class KitcheyApi {
  constructor({ serverUrl, token, householdId }) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.token = token;
    this.householdId = householdId;
  }

  async request(method, path, body = null) {
    const url = new URL(this.serverUrl + path);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'X-Household-Id': this.householdId,
        'Content-Type': 'application/json',
      },
      rejectUnauthorized: false, // allow self-signed certs on local servers
    };

    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async getHouseholds() {
    const url = new URL(this.serverUrl + '/api/households');
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: '/api/households',
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
      rejectUnauthorized: false,
    };
    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  async getInventory() {
    const { body } = await this.request('GET', '/api/inventory');
    return Array.isArray(body) ? body : [];
  }

  async getShopping() {
    const { body } = await this.request('GET', '/api/shopping');
    return Array.isArray(body) ? body : [];
  }

  async addToShopping(name) {
    return this.request('POST', '/api/shopping', { custom_name: name, quantity: 1, unit: 'stk' });
  }

  async useItem(itemId, amount = 1) {
    return this.request('POST', `/api/inventory/${itemId}/use`, { amount });
  }
}

module.exports = KitcheyApi;
