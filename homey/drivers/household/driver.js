'use strict';

const Homey = require('homey');

class HouseholdDriver extends Homey.Driver {
  async onInit() {
    this.log('HouseholdDriver ready');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    if (!app.isConfigured()) throw new Error(this.homey.__('error.not_configured'));
    return [{
      name: this.homey.__('pair.household_name'),
      data: { household_id: app.api.householdId },
    }];
  }
}

module.exports = HouseholdDriver;
