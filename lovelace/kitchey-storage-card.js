/**
 * kitchey-storage-card
 * Lovelace custom card for a Kitchey storage unit sensor.
 *
 * Usage:
 *   type: custom:kitchey-storage-card
 *   entity: sensor.kitchey_<household>_<unit>
 *   title: Køleskab        # optional override
 *   max_items: 10          # optional, default 20
 */

const EXPIRY_DAYS_WARN = 7;
const EXPIRY_DAYS_CRIT = 3;

class KitcheyStorageCard extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    if (!config.entity) throw new Error('entity is required');
    this._config = config;
  }

  getCardSize() { return 3; }

  _render() {
    if (!this._hass || !this._config) return;

    const stateObj = this._hass.states[this._config.entity];
    if (!stateObj) {
      this.innerHTML = `<ha-card><div style="padding:16px;color:var(--error-color)">Entity not found: ${this._config.entity}</div></ha-card>`;
      return;
    }

    const name  = this._config.title || stateObj.attributes.friendly_name || this._config.entity;
    const attrs = stateObj.attributes || {};
    const items = (attrs.items || []).slice(0, this._config.max_items || 20);
    const total = parseInt(stateObj.state) || 0;
    const exp3  = attrs.expiring_3d || 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows = items.map((item) => {
      let expiryHtml = '';
      let rowClass = '';
      if (item.expiry_date) {
        const exp = new Date(item.expiry_date);
        exp.setHours(0, 0, 0, 0);
        const days = Math.round((exp - today) / 86400000);
        const label = days < 0
          ? `<span class="badge expired">Udløbet</span>`
          : days === 0
            ? `<span class="badge crit">I dag</span>`
            : days <= EXPIRY_DAYS_CRIT
              ? `<span class="badge crit">${days}d</span>`
              : days <= EXPIRY_DAYS_WARN
                ? `<span class="badge warn">${days}d</span>`
                : `<span class="badge ok">${days}d</span>`;
        expiryHtml = label;
        if (days < 0) rowClass = 'row-expired';
        else if (days <= EXPIRY_DAYS_CRIT) rowClass = 'row-crit';
        else if (days <= EXPIRY_DAYS_WARN) rowClass = 'row-warn';
      }
      const loc = item.location ? `<span class="loc">${item.location}</span>` : '';
      return `
        <div class="row ${rowClass}">
          <div class="row-main">
            <span class="item-name">${item.name || 'Ukendt'}</span>
            ${loc}
          </div>
          <div class="row-right">
            <span class="qty">${item.quantity} ${item.unit || ''}</span>
            ${expiryHtml}
          </div>
        </div>`;
    }).join('');

    const empty = items.length === 0
      ? `<div class="empty">Ingen varer på lager</div>`
      : '';

    const expAlert = exp3 > 0
      ? `<div class="alert">${exp3} vare${exp3 > 1 ? 'r' : ''} udløber inden 3 dage</div>`
      : '';

    this.innerHTML = `
      <ha-card>
        <style>
          .card-header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px 4px; }
          .card-title  { font-size:15px; font-weight:700; color:var(--primary-text-color); }
          .card-count  { font-size:13px; color:var(--secondary-text-color); background:var(--secondary-background-color); border-radius:12px; padding:2px 9px; }
          .alert       { margin:0 12px 6px; padding:7px 12px; border-radius:8px; font-size:12px; font-weight:600; background:rgba(var(--warning-color-rgb,255,152,0),0.15); color:var(--warning-color,#ff9800); }
          .item-list   { padding:0 8px 8px; }
          .row         { display:flex; align-items:center; justify-content:space-between; padding:7px 8px; border-radius:8px; margin-bottom:2px; }
          .row:hover   { background:var(--secondary-background-color); }
          .row-expired { opacity:0.55; }
          .row-main    { display:flex; flex-direction:column; gap:1px; min-width:0; }
          .row-right   { display:flex; align-items:center; gap:6px; flex-shrink:0; }
          .item-name   { font-size:14px; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
          .loc         { font-size:11px; color:var(--secondary-text-color); }
          .qty         { font-size:13px; color:var(--secondary-text-color); }
          .badge       { font-size:11px; font-weight:700; border-radius:6px; padding:2px 6px; }
          .badge.ok      { background:rgba(76,175,130,0.15); color:#4caf82; }
          .badge.warn    { background:rgba(255,152,0,0.15);  color:#ff9800; }
          .badge.crit    { background:rgba(244,67,54,0.15);  color:#f44336; }
          .badge.expired { background:rgba(0,0,0,0.08);      color:var(--disabled-text-color); }
          .empty { padding:16px; text-align:center; color:var(--secondary-text-color); font-size:13px; }
        </style>
        <div class="card-header">
          <span class="card-title">${name}</span>
          <span class="card-count">${total} varer</span>
        </div>
        ${expAlert}
        <div class="item-list">${rows}${empty}</div>
      </ha-card>`;
  }
}

customElements.define('kitchey-storage-card', KitcheyStorageCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'kitchey-storage-card',
  name: 'Kitchey Storage Card',
  description: 'Displays items in a Kitchey storage unit with expiry badges.',
});
