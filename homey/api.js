'use strict';

// Homey Web API used by the settings page (settings/index.html).

module.exports = {
  async testConnection({ homey, body }) {
    const serverUrl = String((body && body.server_url) || '').trim();
    const token = String((body && body.token) || '').trim();
    if (!serverUrl || !token) throw new Error(homey.__('error.missing_credentials'));
    return homey.app.testConnection({ serverUrl, token });
  },

  async getStatus({ homey }) {
    return homey.app.getStatus();
  },
};
