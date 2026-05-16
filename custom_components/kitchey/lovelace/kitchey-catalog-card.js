/**
 * kitchey-catalog-card
 * Lovelace custom card for the Kitchey catalog sensor.
 * Shows all catalog products with stock levels and category filter.
 *
 * Usage:
 *   type: custom:kitchey-catalog-card
 *   entity: sensor.kitchey_<household>_katalog
 *   title: Katalog    # optional
 */

function formatUnitSize(unit, weightPerUnit) {
  if (!weightPerUnit || !unit || unit === 'stk' || unit === 'pcs') return null;
  if (unit === 'ml') return weightPerUnit >= 1000 ? `${+(weightPerUnit/1000).toFixed(2).replace(/\.?0+$/,'')} L` : `${weightPerUnit} ml`;
  if (unit === 'l')  return `${+weightPerUnit.toFixed(2).replace(/\.?0+$/,'')} L`;
  if (unit === 'g')  return weightPerUnit >= 1000 ? `${+(weightPerUnit/1000).toFixed(2).replace(/\.?0+$/,'')} kg` : `${weightPerUnit} g`;
  if (unit === 'kg') return `${+weightPerUnit.toFixed(2).replace(/\.?0+$/,'')} kg`;
  return `${weightPerUnit} ${unit}`;
}

function formatStock(inStock, unit, weightPerUnit) {
  if (!inStock) return null;
  if (!weightPerUnit || !unit || unit === 'stk' || unit === 'pcs') return `${inStock} stk`;
  const total = inStock * weightPerUnit;
  if (unit === 'ml') return total >= 1000 ? `${+(total/1000).toFixed(2).replace(/\.?0+$/,'')} L` : `${total} ml`;
  if (unit === 'l')  return `${+total.toFixed(2).replace(/\.?0+$/,'')} L`;
  if (unit === 'g')  return total >= 1000 ? `${+(total/1000).toFixed(2).replace(/\.?0+$/,'')} kg` : `${total} g`;
  if (unit === 'kg') return `${+total.toFixed(2).replace(/\.?0+$/,'')} kg`;
  return `${inStock} ${unit}`;
}

const CATEGORY_LABELS = {
  fridge:  { label: 'Køleskab', icon: '🧊' },
  freezer: { label: 'Fryser',   icon: '❄️' },
  pantry:  { label: 'Kolonial', icon: '🥫' },
};

class KitcheyCatalogCard extends HTMLElement {
  constructor() {
    super();
    this._filter = 'all';
    this._search = '';
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    if (!config.entity) throw new Error('entity is required');
    this._config = config;
  }

  getCardSize() { return 4; }

  _render() {
    if (!this._hass || !this._config) return;

    const stateObj = this._hass.states[this._config.entity];
    if (!stateObj) {
      this.innerHTML = `<ha-card><div style="padding:16px;color:var(--error-color)">Entity not found: ${this._config.entity}</div></ha-card>`;
      return;
    }

    const title = this._config.title || stateObj.attributes.friendly_name || 'Katalog';
    const allProducts = stateObj.attributes.products || [];

    const filtered = allProducts.filter(p => {
      const matchCat = this._filter === 'all' || p.category === this._filter;
      const matchSearch = !this._search || p.name?.toLowerCase().includes(this._search) || p.brand?.toLowerCase().includes(this._search);
      return matchCat && matchSearch;
    });

    const categories = [...new Set(allProducts.map(p => p.category).filter(Boolean))];

    const filterTabs = [
      `<button class="tab ${this._filter === 'all' ? 'active' : ''}" data-cat="all">Alle (${allProducts.length})</button>`,
      ...categories.map(cat => {
        const count = allProducts.filter(p => p.category === cat).length;
        const info = CATEGORY_LABELS[cat] || { label: cat, icon: '📦' };
        return `<button class="tab ${this._filter === cat ? 'active' : ''}" data-cat="${cat}">${info.icon} ${info.label} (${count})</button>`;
      }),
    ].join('');

    const rows = filtered.map(p => {
      const name  = p.name || 'Ukendt';
      const unitSize = formatUnitSize(p.unit, p.weight_per_unit);
      const subParts = [p.brand, unitSize].filter(Boolean);
      const brand = subParts.length ? `<span class="brand">${subParts.join(' · ')}</span>` : '';
      const stock = p.in_stock ?? 0;
      const stockClass = stock > 0 ? 'stock-ok' : 'stock-empty';
      const stockLabel = stock > 0 ? `${stock} stk` : 'Ikke på lager';
      const cat = CATEGORY_LABELS[p.category] || { icon: '📦' };
      return `
        <div class="prod-row">
          <span class="prod-icon">${cat.icon}</span>
          <div class="prod-info">
            <div class="prod-name">${name}${brand}</div>
          </div>
          <div class="prod-stock ${stockClass}">${stockLabel}</div>
        </div>`;
    }).join('');

    const empty = filtered.length === 0
      ? `<div class="empty">Ingen produkter fundet</div>`
      : '';

    this.innerHTML = `
      <ha-card>
        <style>
          .card-header  { display:flex; align-items:center; justify-content:space-between; padding:12px 16px 8px; }
          .card-title   { font-size:15px; font-weight:700; color:var(--primary-text-color); }
          .card-count   { font-size:13px; color:var(--secondary-text-color); background:var(--secondary-background-color); border-radius:12px; padding:2px 9px; }
          .search-row   { padding:0 16px 8px; }
          .search-input { width:100%; box-sizing:border-box; padding:8px 12px; border:1px solid var(--divider-color); border-radius:8px; background:var(--card-background-color); color:var(--primary-text-color); font-size:14px; outline:none; }
          .search-input:focus { border-color:var(--primary-color); }
          .tabs         { display:flex; gap:6px; padding:0 16px 8px; flex-wrap:wrap; }
          .tab          { padding:4px 10px; border:1px solid var(--divider-color); border-radius:16px; background:none; color:var(--secondary-text-color); font-size:12px; cursor:pointer; white-space:nowrap; }
          .tab.active   { background:var(--primary-color); color:var(--text-primary-color); border-color:var(--primary-color); }
          .prod-list    { padding:0 8px 8px; }
          .prod-row     { display:flex; align-items:center; gap:10px; padding:8px 8px; border-radius:8px; }
          .prod-row:hover { background:var(--secondary-background-color); }
          .prod-icon    { font-size:18px; flex-shrink:0; width:24px; text-align:center; }
          .prod-info    { flex:1; min-width:0; }
          .prod-name    { font-size:14px; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .brand        { font-size:12px; color:var(--secondary-text-color); margin-left:6px; }
          .prod-stock   { font-size:13px; flex-shrink:0; border-radius:10px; padding:2px 8px; }
          .stock-ok     { color:#2e7d32; background:#e8f5e9; }
          .stock-empty  { color:var(--secondary-text-color); background:var(--secondary-background-color); }
          .empty        { padding:16px; text-align:center; color:var(--secondary-text-color); font-size:13px; }
        </style>
        <div class="card-header">
          <span class="card-title">${title}</span>
          <span class="card-count">${filtered.length} / ${allProducts.length}</span>
        </div>
        <div class="search-row">
          <input class="search-input" id="catalog-search" placeholder="Søg produkt…" value="${this._search}" />
        </div>
        <div class="tabs">${filterTabs}</div>
        <div class="prod-list">${rows}${empty}</div>
      </ha-card>`;

    // Category filter tabs
    this.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._filter = btn.dataset.cat;
        this._render();
      });
    });

    // Search
    const searchInput = this.querySelector('#catalog-search');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        this._search = e.target.value.trim().toLowerCase();
        this._render();
      });
      // Restore focus if was searching
      if (this._search) searchInput.focus();
    }
  }
}

if (!customElements.get('kitchey-catalog-card')) {
  customElements.define('kitchey-catalog-card', KitcheyCatalogCard);
}
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'kitchey-catalog-card',
  name: 'Kitchey Catalog Card',
  description: 'Shows Kitchey product catalog with stock levels and category filter.',
});
