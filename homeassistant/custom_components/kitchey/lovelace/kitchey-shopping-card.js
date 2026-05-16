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
 * Requires: Home Assistant services kitchey.add_to_shopping, kitchey.check_shopping_item,
 *           kitchey.update_shopping_item
 */

class KitcheyShoppingCard extends HTMLElement {
  constructor() {
    super();
    this._pendingChecks = new Set();
    this._editingId = null;
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

  _checkItem(itemId) {
    if (this._pendingChecks.has(itemId)) return;
    this._pendingChecks.add(itemId);
    this._callService('kitchey', 'check_shopping_item', {
      item_id: itemId,
      checked_by: 'Lovelace',
    });
    const el = this.querySelector(`.shop-row[data-id="${itemId}"]`);
    if (el) {
      el.style.opacity = '0.3';
      el.style.textDecoration = 'line-through';
    }
    setTimeout(() => this._pendingChecks.delete(itemId), 10000);
  }

  _startEdit(itemId, currentQty, currentUnit) {
    if (this._editingId === itemId) {
      this._editingId = null;
    } else {
      this._editingId = itemId;
    }
    this._render();
    // Focus qty input after render
    if (this._editingId) {
      setTimeout(() => {
        const el = this.querySelector(`#edit-qty-${itemId}`);
        if (el) el.focus();
      }, 0);
    }
  }

  _saveEdit(itemId) {
    const qtyEl  = this.querySelector(`#edit-qty-${itemId}`);
    const unitEl = this.querySelector(`#edit-unit-${itemId}`);
    const quantity = parseInt(qtyEl?.value) || 1;
    const unit = unitEl?.value.trim() || 'stk';
    this._callService('kitchey', 'update_shopping_item', {
      item_id: itemId,
      quantity,
      unit,
    });
    this._editingId = null;
    this._render();
  }

  _addItem() {
    const nameInput = this.querySelector('#kitchey-add-input');
    const qtyInput  = this.querySelector('#kitchey-add-qty');
    const unitInput = this.querySelector('#kitchey-add-unit');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) return;
    const quantity = parseInt(qtyInput?.value) || 1;
    const unit = unitInput?.value.trim() || 'stk';
    this._callService('kitchey', 'add_to_shopping', { name, quantity, unit });
    nameInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    if (unitInput) unitInput.value = 'stk';
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
      const qty  = item.quantity ?? 1;
      const unit = item.unit || 'stk';
      const isEditing = this._editingId === item.id;

      const qtyCell = isEditing
        ? `<div class="edit-inline">
             <input id="edit-qty-${item.id}"  class="edit-qty"  type="number" min="1" value="${qty}" />
             <input id="edit-unit-${item.id}" class="edit-unit" type="text"   value="${unit}" />
             <button class="save-btn" data-id="${item.id}">✓</button>
           </div>`
        : `<div class="shop-qty">${qty} ${unit}</div>
           <button class="edit-btn" data-id="${item.id}" title="Ret antal">✏️</button>`;

      return `
        <div class="shop-row" data-id="${item.id}">
          <div class="check-btn" data-id="${item.id}" title="Markér som fundet">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>
          </div>
          <div class="shop-name">${name}</div>
          ${qtyCell}
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
          .shop-row     { display:flex; align-items:center; gap:10px; padding:8px 8px; border-radius:8px; }
          .check-btn    { color:var(--secondary-text-color); flex-shrink:0; display:flex; align-items:center; cursor:pointer; }
          .check-btn:hover { color:var(--primary-color); }
          .shop-name    { flex:1; font-size:14px; color:var(--primary-text-color); min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .shop-qty     { font-size:13px; color:var(--secondary-text-color); flex-shrink:0; }
          .edit-btn     { background:none; border:none; cursor:pointer; font-size:13px; padding:2px 4px; opacity:0.5; flex-shrink:0; }
          .edit-btn:hover { opacity:1; }
          .edit-inline  { display:flex; align-items:center; gap:4px; flex-shrink:0; }
          .edit-qty     { width:52px; padding:4px 6px; border:1px solid var(--primary-color); border-radius:6px; background:var(--card-background-color); color:var(--primary-text-color); font-size:13px; text-align:center; outline:none; }
          .edit-unit    { width:60px; padding:4px 6px; border:1px solid var(--primary-color); border-radius:6px; background:var(--card-background-color); color:var(--primary-text-color); font-size:13px; outline:none; }
          .save-btn     { padding:4px 8px; background:var(--primary-color); color:var(--text-primary-color); border:none; border-radius:6px; font-size:14px; cursor:pointer; }
          .add-row      { display:flex; gap:8px; padding:8px 16px 4px; }
          .add-row2     { display:flex; gap:8px; padding:4px 16px 12px; }
          .add-input    { flex:1; padding:8px 12px; border:1px solid var(--divider-color); border-radius:8px; background:var(--card-background-color); color:var(--primary-text-color); font-size:14px; outline:none; }
          .add-input:focus { border-color:var(--primary-color); }
          .add-qty      { width:64px; padding:8px 8px; border:1px solid var(--divider-color); border-radius:8px; background:var(--card-background-color); color:var(--primary-text-color); font-size:14px; outline:none; text-align:center; }
          .add-qty:focus { border-color:var(--primary-color); }
          .add-unit     { width:72px; padding:8px 8px; border:1px solid var(--divider-color); border-radius:8px; background:var(--card-background-color); color:var(--primary-text-color); font-size:14px; outline:none; }
          .add-unit:focus { border-color:var(--primary-color); }
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
        </div>
        <div class="add-row2">
          <input id="kitchey-add-qty"  class="add-qty"   type="number" min="1" value="1" placeholder="Antal" />
          <input id="kitchey-add-unit" class="add-unit"  type="text"   value="stk" placeholder="Enhed" />
          <button class="add-btn" id="kitchey-add-btn">+</button>
        </div>
      </ha-card>`;

    // Check buttons
    this.querySelectorAll('.check-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._checkItem(btn.dataset.id);
      });
    });

    // Edit toggle buttons
    this.querySelectorAll('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('.shop-row');
        const qty  = row.querySelector('.shop-qty')?.textContent.trim().split(' ')[0] || '1';
        const unit = row.querySelector('.shop-qty')?.textContent.trim().split(' ')[1] || 'stk';
        this._startEdit(btn.dataset.id, qty, unit);
      });
    });

    // Save buttons
    this.querySelectorAll('.save-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._saveEdit(btn.dataset.id);
      });
    });

    // Enter key in edit fields
    this.querySelectorAll('.edit-qty, .edit-unit').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const id = input.id.replace(/^edit-(qty|unit)-/, '');
          this._saveEdit(id);
        }
        if (e.key === 'Escape') {
          this._editingId = null;
          this._render();
        }
      });
    });

    // Add item button + enter key
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
