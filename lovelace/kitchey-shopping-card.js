/**
 * kitchey-shopping-card
 * Lovelace custom card for the Kitchey shopping list sensor.
 * Shows unchecked items, tap to check off, inline field to add custom item.
 *
 * Usage:
 *   type: custom:kitchey-shopping-card
 *   entity: sensor.kitchey_<household>_indkøbsliste
 *   title: Indkøbsliste    # optional
 *
 * Requires: Home Assistant services kitchey.add_to_shopping and kitchey.check_shopping_item
 */

class KitcheyShoppingCard extends HTMLElement {
  constructor() {
    super();
    this._pendingChecks = new Set();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    if (!config.entity) throw new Error('entity is required');
    this._config = config;
  }

  getCardSize() { return 3; }

  _callService(domain, service, data) {
    if (!this._hass) return;
    this._hass.callService(domain, service, data);
  }

  _checkItem(itemId, itemName) {
    if (this._pendingChecks.has(itemId)) return;
    this._pendingChecks.add(itemId);
    this._callService('kitchey', 'check_shopping_item', {
      item_id: itemId,
      checked_by: 'Lovelace',
    });
    // Optimistic re-render: remove item from list temporarily
    const el = this.querySelector(`[data-id="${itemId}"]`);
    if (el) {
      el.style.opacity = '0.3';
      el.style.textDecoration = 'line-through';
    }
    // Clear pending after a few seconds (coordinator will refresh)
    setTimeout(() => this._pendingChecks.delete(itemId), 10000);
  }

  _addItem() {
    const input = this.querySelector('#kitchey-add-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;
    this._callService('kitchey', 'add_to_shopping', { name });
    input.value = '';
  }

  _render() {
    if (!this._hass || !this._config) return;

    const stateObj = this._hass.states[this._config.entity];
    if (!stateObj) {
      this.innerHTML = `<ha-card><div style="padding:16px;color:var(--error-color)">Entity not found: ${this._config.entity}</div></ha-card>`;
      return;
    }

    const title = this._config.title || stateObj.attributes.friendly_name || 'Indkøbsliste';
    const items = stateObj.attributes.items || [];
    const count = parseInt(stateObj.state) || 0;

    const rows = items.map((item) => {
      const name = item.name || 'Ukendt';
      const qty  = `${item.quantity} ${item.unit || 'stk'}`;
      return `
        <div class="shop-row" data-id="${item.id}" title="Tryk for at markere som fundet">
          <div class="check-btn" data-id="${item.id}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>
          </div>
          <div class="shop-name">${name}</div>
          <div class="shop-qty">${qty}</div>
        </div>`;
    }).join('');

    const empty = items.length === 0
      ? `<div class="empty">Ingen varer på listen 🎉</div>`
      : '';

    this.innerHTML = `
      <ha-card>
        <style>
          .card-header  { display:flex; align-items:center; justify-content:space-between; padding:12px 16px 8px; }
          .card-title   { font-size:15px; font-weight:700; color:var(--primary-text-color); }
          .card-count   { font-size:13px; color:var(--secondary-text-color); background:var(--secondary-background-color); border-radius:12px; padding:2px 9px; }
          .item-list    { padding:0 8px 4px; }
          .shop-row     { display:flex; align-items:center; gap:10px; padding:8px 8px; border-radius:8px; cursor:pointer; transition:background 120ms; }
          .shop-row:hover { background:var(--secondary-background-color); }
          .check-btn    { color:var(--secondary-text-color); flex-shrink:0; display:flex; align-items:center; }
          .shop-name    { flex:1; font-size:14px; color:var(--primary-text-color); min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .shop-qty     { font-size:13px; color:var(--secondary-text-color); flex-shrink:0; }
          .add-row      { display:flex; gap:8px; padding:8px 16px 12px; }
          .add-input    { flex:1; padding:8px 12px; border:1px solid var(--divider-color); border-radius:8px; background:var(--card-background-color); color:var(--primary-text-color); font-size:14px; outline:none; }
          .add-input:focus { border-color:var(--primary-color); }
          .add-btn      { padding:8px 14px; background:var(--primary-color); color:var(--text-primary-color); border:none; border-radius:8px; font-size:18px; font-weight:700; cursor:pointer; }
          .empty        { padding:12px 16px; color:var(--secondary-text-color); font-size:13px; text-align:center; }
        </style>
        <div class="card-header">
          <span class="card-title">${title}</span>
          <span class="card-count">${count}</span>
        </div>
        <div class="item-list">${rows}${empty}</div>
        <div class="add-row">
          <input id="kitchey-add-input" class="add-input" placeholder="Tilføj vare…" />
          <button class="add-btn" id="kitchey-add-btn">+</button>
        </div>
      </ha-card>`;

    // Attach events after render
    this.querySelectorAll('.shop-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        const name = row.querySelector('.shop-name')?.textContent || '';
        this._checkItem(id, name);
      });
    });

    const addBtn = this.querySelector('#kitchey-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => this._addItem());

    const addInput = this.querySelector('#kitchey-add-input');
    if (addInput) {
      addInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._addItem();
      });
    }
  }
}

customElements.define('kitchey-shopping-card', KitcheyShoppingCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'kitchey-shopping-card',
  name: 'Kitchey Shopping Card',
  description: 'Shows Kitchey shopping list with tap-to-check and inline add.',
});
