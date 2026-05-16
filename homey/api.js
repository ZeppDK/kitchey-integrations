'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const OFFICIAL_SERVER = 'kitchey.aihuset.dk';

class KitcheyApi {
  constructor({ serverUrl, token, householdId }) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.token = token;
    this.householdId = householdId;
  }

  get isOfficialServer() {
    return this.serverUrl.includes(OFFICIAL_SERVER);
  }

  async request(method, path, body = null, extraHeaders = {}, _redirectCount = 0, _baseUrl = null) {
    const baseUrl = _baseUrl || this.serverUrl;
    const url = new URL(baseUrl + path);
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
        ...extraHeaders,
      },
      rejectUnauthorized: this.isOfficialServer,
    };

    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        // Follow redirects (max 5)
        if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location && _redirectCount < 5) {
          const location = res.headers.location;
          const redirectUrl = location.startsWith('http') ? new URL(location) : new URL(location, baseUrl);
          const redirectBase = `${redirectUrl.protocol}//${redirectUrl.host}`;
          this.request(method, redirectUrl.pathname + redirectUrl.search, body, extraHeaders, _redirectCount + 1, redirectBase)
            .then(resolve)
            .catch(reject);
          res.resume(); // discard body
          return;
        }

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

  async requestNoHousehold(method, path, body = null) {
    return this.request(method, path, body, { 'X-Household-Id': '' });
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

  async getStorageUnits() {
    const { body } = await this.request('GET', '/api/storage-units');
    return Array.isArray(body) ? body : [];
  }

  async getPremiumStatus() {
    const url = new URL(this.serverUrl + '/api/premium/status');
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: '/api/premium/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
      rejectUnauthorized: false,
    };
    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: {} }); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  async getCatalog() {
    const { body } = await this.request('GET', '/api/catalog');
    return Array.isArray(body) ? body : [];
  }

  async createCatalogProduct(name, unit = 'stk', category = 'pantry', brand = null) {
    const body = { name, unit, category };
    if (brand) body.brand = brand;
    return this.request('POST', '/api/catalog', body);
  }

  // ── Shopping ────────────────────────────────────────────────────────────

  async addToShopping(name, quantity = 1, unit = 'stk') {
    return this.request('POST', '/api/shopping', { custom_name: name, quantity, unit });
  }

  async deleteShoppingItem(itemId) {
    return this.request('DELETE', `/api/shopping/${itemId}`);
  }

  async checkShoppingItem(itemId, checkedBy = 'Homey') {
    return this.request('PUT', `/api/shopping/${itemId}`, { checked: true, checked_by: checkedBy });
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async useItem(itemId, amount = 1) {
    return this.request('POST', `/api/inventory/${itemId}/use`, { amount });
  }

  async addInventoryItem(productId, quantity, listType, expiryDate = null, locationId = null) {
    const body = { product_id: productId, quantity, list_type: listType };
    if (expiryDate) body.expiry_date = expiryDate;
    if (locationId) body.location_id = locationId;
    return this.request('POST', '/api/inventory', body);
  }

  // ── Creation (premium-gated) ────────────────────────────────────────────

  async checkPremiumOrThrow() {
    if (!this.isOfficialServer) return; // self-hosted — no restriction
    const { body } = await this.getPremiumStatus();
    if (!body.isPremium) {
      throw new Error('Premium kræves for at oprette ekstra enheder. Opgrader i Kitchey-appen.');
    }
  }

  async createStorageUnit(name, listType, icon = '') {
    await this.checkPremiumOrThrow();
    const body = { name, list_type: listType };
    if (icon) body.icon = icon;
    return this.request('POST', '/api/storage-units', body);
  }

  async createShelf(name, storageUnitId) {
    await this.checkPremiumOrThrow();
    return this.request('POST', '/api/locations', { name, storage_unit_id: storageUnitId });
  }
}

module.exports = KitcheyApi;
