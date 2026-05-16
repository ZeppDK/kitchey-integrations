'use strict';

const Homey = require('homey');

class ShoppingDriver extends Homey.Driver {
  async onInit() {
    this.log('ShoppingDriver ready');
  }

  async onPair(session) {
    const householdId = this.homey.settings.get('household_id') || 'shopping_list';

    session.setHandler('list_devices', async () => {
      // There is always exactly one shopping list per household — present it immediately.
      return [
        {
          name: 'Indkøbsliste',
          data: { household_id: householdId },
        },
      ];
    });
  }

  updateDevices(shopping) {
    const unchecked = shopping.filter((s) => !s.checked).length;
    for (const device of this.getDevices()) {
      device.setCapabilityValue('measure_shopping_count', unchecked).catch(() => {});
    }
  }
}

module.exports = ShoppingDriver;
