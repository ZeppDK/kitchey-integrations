'use strict';

const Homey = require('homey');

class ShoppingDriver extends Homey.Driver {
  async onInit() {
    this.log('ShoppingDriver ready');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    if (!app.isConfigured()) throw new Error(this.homey.__('error.not_configured'));
    return [{
      name: this.homey.__('pair.shopping_name'),
      data: { household_id: app.api.householdId },
    }];
  }
}

module.exports = ShoppingDriver;
