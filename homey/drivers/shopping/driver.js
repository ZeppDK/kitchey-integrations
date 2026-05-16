'use strict';

const Homey = require('homey');

class ShoppingDriver extends Homey.Driver {
  async onInit() {
    this.log('ShoppingDriver ready');
  }

  async onPairListDevices() {
    const householdId = this.homey.settings.get('household_id') || 'shopping_list';
    return [
      {
        name: 'Indkøbsliste',
        data: { household_id: householdId },
      },
    ];
  }

  updateDevices(shopping) {
    for (const device of this.getDevices()) {
      device.updateShopping(shopping).catch(() => {});
    }
  }
}

module.exports = ShoppingDriver;
