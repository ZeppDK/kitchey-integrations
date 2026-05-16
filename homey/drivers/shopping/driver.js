'use strict';

const Homey = require('homey');

class ShoppingDriver extends Homey.Driver {
  async onInit() {
    this.log('ShoppingDriver ready');
  }

  /**
   * Called by app.js after each poll to ensure exactly one shopping list device exists.
   */
  async ensureDevice(householdId) {
    const existing = this.getDevices();
    if (existing.length === 0) {
      try {
        await this.createDevice({
          name: 'Indkøbsliste',
          data: { household_id: householdId },
        });
        this.log('Created ShoppingDevice');
      } catch (err) {
        this.error('Failed to create ShoppingDevice:', err.message);
      }
    }
  }

  updateDevices(shopping) {
    const unchecked = shopping.filter((s) => !s.checked).length;
    for (const device of this.getDevices()) {
      device.setCapabilityValue('measure_shopping_count', unchecked).catch(() => {});
    }
  }
}

module.exports = ShoppingDriver;
