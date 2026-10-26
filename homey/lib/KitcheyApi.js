'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const OFFICIAL_SERVER = 'kitchey.aihuset.dk';
const TIMEOUT_MS = 15000;

class KitcheyApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'KitcheyApiError';
    this.status = status;
  }
}

/**
 * Thin HTTP client for the Kitchey REST API.
 * Every method resolves with the parsed JSON body and throws KitcheyApiError on non-2xx.
 */
class KitcheyApi {
  constructor({ serverUrl, token, householdId }) {
    this.serverUrl = String(serverUrl || '').trim().replace(/\/+$/, '');
    this.token = token;
    this.householdId = householdId;
  }

  get isOfficialServer() {
    return this.serverUrl.includes(OFFICIAL_SERVER);
  }

  _raw(method, path, body, { household = true, redirects = 0, baseUrl = null } = {}) {
    const base = baseUrl || this.serverUrl;
    const url = new URL(base + path);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
    if (household && this.householdId) headers['X-Household-Id'] = this.householdId;
    let payload = null;
    if (body !== null && body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      // Self-hosted servers often use self-signed certificates.
      rejectUnauthorized: this.isOfficialServer,
    };

    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location && redirects < 5) {
          const target = new URL(res.headers.location, base);
          res.resume();
          this._raw(method, target.pathname + target.search, body, {
            household, redirects: redirects + 1, baseUrl: `${target.protocol}//${target.host}`,
          }).then(resolve, reject);
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = data;
          try { parsed = data ? JSON.parse(data) : null; } catch { /* keep raw text */ }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`Timeout after ${TIMEOUT_MS / 1000}s`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async request(method, path, body = null, opts = {}) {
    const { status, body: data } = await this._raw(method, path, body, opts);
    if (status < 200 || status >= 300) {
      const msg = (data && typeof data === 'object' && data.error)
        ? `${data.error} (${status})`
        : (status === 401 ? 'Ugyldig adgangsnøgle (401)'
          : status === 403 ? 'Ingen adgang til husstanden (403)'
            : status === 404 ? 'Ikke fundet (404)'
              : `HTTP ${status}`);
      throw new KitcheyApiError(status, msg);
    }
    return data;
  }

  async _list(path) {
    const data = await this.request('GET', path);
    return Array.isArray(data) ? data : [];
  }

  // ── Account (no household header) ──────────────────────────────────────

  getHouseholds() { return this.request('GET', '/api/households', null, { household: false }); }

  getPremiumStatus() { return this.request('GET', '/api/premium/status', null, { household: false }); }

  // ── Reads ──────────────────────────────────────────────────────────────

  getInventory() { return this._list('/api/inventory'); }

  getShopping() { return this._list('/api/shopping'); }

  getStorageUnits() { return this._list('/api/storage-units'); }

  getLocations() { return this._list('/api/locations'); }

  getCatalog() { return this._list('/api/catalog'); }

  // ── Shopping ───────────────────────────────────────────────────────────

  addToShopping({ productId = null, name = null, quantity = 1, unit = 'stk' }) {
    const body = { quantity, unit, added_by: 'Homey' };
    if (productId) body.product_id = productId; else body.custom_name = name;
    return this.request('POST', '/api/shopping', body);
  }

  updateShoppingItem(id, patch) {
    return this.request('PUT', `/api/shopping/${encodeURIComponent(id)}`, patch);
  }

  checkShoppingItem(id, checked = true) {
    return this.updateShoppingItem(id, { checked, checked_by: 'Homey' });
  }

  deleteShoppingItem(id) {
    return this.request('DELETE', `/api/shopping/${encodeURIComponent(id)}`);
  }

  clearCheckedShopping() {
    return this.request('DELETE', '/api/shopping/checked');
  }

  // ── Inventory ──────────────────────────────────────────────────────────

  addInventoryItem({ productId, listType, quantity = 1, expiryDate = null, locationId = null }) {
    const body = { product_id: productId, list_type: listType, quantity };
    if (expiryDate) body.expiry_date = expiryDate;
    if (locationId) body.location_id = locationId;
    return this.request('POST', '/api/inventory', body);
  }

  /** PUT overwrites every field, so always send the full current item merged with the patch. */
  updateInventoryItem(item, patch) {
    const body = {
      quantity: item.quantity,
      location_id: item.location_id || null,
      expiry_date: item.expiry_date || null,
      notes: item.notes || null,
      opened: !!item.opened,
      opened_at: item.opened_at || null,
      ...patch,
    };
    return this.request('PUT', `/api/inventory/${encodeURIComponent(item.id)}`, body);
  }

  useItem(id, amount = 1) {
    return this.request('POST', `/api/inventory/${encodeURIComponent(id)}/use`, { amount });
  }

  deleteInventoryItem(id) {
    return this.request('DELETE', `/api/inventory/${encodeURIComponent(id)}`);
  }

  // ── Catalog & structure ────────────────────────────────────────────────

  createCatalogProduct({ name, unit = 'stk', category = 'pantry', brand = null }) {
    const body = { name, unit, category };
    if (brand) body.brand = brand;
    return this.request('POST', '/api/catalog', body);
  }

  createStorageUnit({ name, listType, icon = null }) {
    const body = { name, list_type: listType };
    if (icon) body.icon = icon;
    return this.request('POST', '/api/storage-units', body);
  }

  createShelf({ name, storageUnitId, listType }) {
    return this.request('POST', '/api/locations', { name, storage_unit_id: storageUnitId, list_type: listType });
  }
}

KitcheyApi.KitcheyApiError = KitcheyApiError;
module.exports = KitcheyApi;
