'use strict';

const Homey = require('homey');
const KitcheyApi = require('./api');

class KitcheyApp extends Homey.App {
  async onInit() {
    this.log('Kitchey starting...');
    this._api = null;
    this._pollInterval = null;
    this._lastShoppingCount = 0;
    this._firedExpiry = new Set(); // "itemId:YYYY-MM-DD" to avoid re-firing daily

    this.homey.settings.on('set', () => this._reinit());
    await this._reinit();
    this._registerFlowActions();
    this.log('Kitchey ready');
  }

  async _reinit() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    const serverUrl = this.homey.settings.get('server_url');
    const token = this.homey.settings.get('token');
    const householdId = this.homey.settings.get('household_id');
    if (!serverUrl || !token || !householdId) return;

    this._api = new KitcheyApi({ serverUrl, token, householdId });
    await this._poll();
    this._pollInterval = setInterval(() => this._poll(), 30 * 60 * 1000); // 30 min
  }

  async _poll() {
    if (!this._api) return;
    try {
      const [inventory, shopping] = await Promise.all([
        this._api.getInventory(),
        this._api.getShopping(),
      ]);
      this._checkExpiry(inventory);
      this._checkShopping(shopping);
    } catch (err) {
      this.error('Poll failed:', err.message);
    }
  }

  _checkExpiry(items) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const item of items) {
      if (!item.expiry_date) continue;
      const exp = new Date(item.expiry_date.slice(0, 10));
      const daysLeft = Math.round((exp - today) / 86400000);
      const key = `${item.id}:${item.expiry_date.slice(0, 10)}`;
      if (this._firedExpiry.has(key)) continue;

      this.homey.flow.getTriggerCard('item_expires_soon')
        .trigger({ item_name: item.name, expiry_date: item.expiry_date.slice(0, 10), quantity: item.quantity })
        .catch(() => {});
      this._firedExpiry.add(key);
    }
  }

  _checkShopping(shopping) {
    const unchecked = shopping.filter((s) => !s.checked).length;
    const prev = this._lastShoppingCount;
    this._lastShoppingCount = unchecked;
    if (unchecked > prev) {
      this.homey.flow.getTriggerCard('shopping_count_above')
        .trigger({})
        .catch(() => {});
    }
  }

  _registerFlowActions() {
    this.homey.flow.getActionCard('add_to_shopping').registerRunListener(async (args) => {
      if (!this._api) throw new Error('Kitchey not configured');
      await this._api.addToShopping(args.name);
    });

    this.homey.flow.getActionCard('use_item').registerRunListener(async (args) => {
      if (!this._api) throw new Error('Kitchey not configured');
      await this._api.useItem(args.item_id, args.amount ?? 1);
    });
  }
}

module.exports = KitcheyApp;
