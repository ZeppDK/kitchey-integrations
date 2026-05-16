'use strict';

const Homey = require('homey');

class ShoppingDevice extends Homey.Device {
  async onInit() {
    this.log('ShoppingDevice init');
    const app = this.homey.app;
    if (app._lastShopping) {
      await this.updateShopping(app._lastShopping).catch((err) => this.error('updateShopping failed:', err.message));
    } else {
      app._poll().catch((err) => this.error('poll failed:', err.message));
    }
  }

  async updateShopping(shopping) {
    const unchecked = shopping.filter((s) => !s.checked);

    // Update count capability
    await this.setCapabilityValue('measure_shopping_count', unchecked.length).catch(() => {});

    // Remove dynamic capabilities beyond current list length
    const existing = this.getCapabilities().filter((c) => c.startsWith('shopping_item.'));
    for (const cap of existing) {
      const idx = parseInt(cap.split('.')[1], 10);
      if (idx >= unchecked.length) {
        await this.removeCapability(cap).catch(() => {});
      }
    }

    // Add/update one capability per unchecked item
    for (let i = 0; i < unchecked.length; i++) {
      const capId = `shopping_item.${i}`;
      if (!this.hasCapability(capId)) {
        await this.addCapability(capId).catch(() => {});
      }
      const item = unchecked[i];
      const name = item.product_name || item.custom_name || 'Ukendt';
      await this.setCapabilityOptions(capId, { title: { en: name, da: name } }).catch(() => {});
      await this.setCapabilityValue(capId, `${item.quantity} ${item.unit}`).catch(() => {});
    }
  }

  async onDeleted() {
    this.log('ShoppingDevice deleted');
  }
}

module.exports = ShoppingDevice;
