'use strict';

const Homey = require('homey');

class ShoppingDevice extends Homey.Device {
  async onInit() {
    this.log('ShoppingDevice init');
  }

  async onDeleted() {
    this.log('ShoppingDevice deleted');
  }
}

module.exports = ShoppingDevice;
