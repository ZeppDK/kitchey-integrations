'use strict';

const Homey = require('homey');

class ShoppingDriver extends Homey.Driver {
  async onInit() {
    this.log('ShoppingDriver ready');
  }

  /**
   * Ensure exactly one ShoppingDevice exists per household.
   * Called by app.js after first successful poll.
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

  async onPair() {}
}

module.exports = ShoppingDriver;
