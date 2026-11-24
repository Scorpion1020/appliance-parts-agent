const state = {
  cartId: null,
  selectedProduct: null,
};

const el = {
  searchForm: document.querySelector("#search-form"),
  query: document.querySelector("#query"),
  category: document.querySelector("#category"),
  market: document.querySelector("#market"),
  language: document.querySelector("#language"),
  color: document.querySelector("#color"),
  size: document.querySelector("#size"),
  brand: document.querySelector("#brand"),
  availableOnly: document.querySelector("#available-only"),
  minPrice: document.querySelector("#min-price"),
  maxPrice: document.querySelector("#max-price"),
  limit: document.querySelector("#limit"),
  offset: document.querySelector("#offset"),
  results: document.querySelector("#results"),
  searchStatus: document.querySelector("#search-status"),
  detail: document.querySelector("#detail"),
  createCart: document.querySelector("#create-cart"),
  cartRecommendations: document.querySelector("#cart-recommendations"),
  recommendations: document.querySelector("#recommendations"),
  recommendationStatus: document.querySelector("#recommendation-status"),
  cartId: document.querySelector("#cart-id"),
  cart: document.querySelector("#cart"),
  cartStatus: document.querySelector("#cart-status"),
};

function money(value, currency) {
  if (value === null || value === undefined || value === "") return "Price unavailable";
  return `${Number(value).toFixed(2)} ${currency || ""}`.trim();
}

function setStatus(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle("error", isError);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) {
    const error = body.error || {};
    throw new Error(`${error.code || response.status}: ${error.message || "Request failed"}`);
  }
  return body;
}

async function searchProducts(event) {
  event?.preventDefault();
  setStatus(el.searchStatus, "Searching...");
  el.results.innerHTML = "";

  const params = new URLSearchParams();
  appendParam(params, "q", el.query.value);
  appendParam(params, "category", el.category.value);
  appendParam(params, "market_id", el.market.value);
  appendParam(params, "language", el.language.value);
  appendParam(params, "color", el.color.value);
  appendParam(params, "size", el.size.value);
  appendParam(params, "brand", el.brand.value);
  appendParam(params, "available_only", el.availableOnly.value);
  appendParam(params, "min_price", el.minPrice.value);
  appendParam(params, "max_price", el.maxPrice.value);
  appendParam(params, "limit", el.limit.value);
  appendParam(params, "offset", el.offset.value);

  try {
    const body = await request(`/products/search?${params}`);
    setStatus(el.searchStatus, `${body.total} result${body.total === 1 ? "" : "s"}`);
    renderResults(body.results);
  } catch (error) {
    setStatus(el.searchStatus, error.message, true);
  }
}

function appendParam(params, key, value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed !== "") params.set(key, trimmed);
}

function renderResults(results) {
  if (!results.length) {
    el.results.innerHTML = '<div class="empty">No products found</div>';
    return;
  }

  el.results.innerHTML = results
    .map(
      (product) => `
        <article class="result">
          <div class="result-main">
            <div class="name">${product.name}</div>
            <div class="meta">${money(product.price, product.currency)} - ${product.stock_qty ?? 0} in stock</div>
          </div>
          <div class="actions">
            <button class="secondary" type="button" data-detail="${product.id}">View</button>
            <input class="qty" aria-label="Quantity" type="number" min="1" value="1" data-qty="${product.id}" />
            <button type="button" data-add="${product.id}">Add</button>
          </div>
        </article>
      `
    )
    .join("");
}

async function showProduct(productId) {
  el.detail.textContent = "Loading...";
  try {
    const product = await request(`/products/${productId}`);
    state.selectedProduct = product;
    el.detail.classList.remove("empty");
    el.detail.innerHTML = `
      <div class="detail-title">
        <h2>${product.name}</h2>
        <div class="meta">${product.id} - ${product.category || "uncategorized"}</div>
      </div>
      <div>${money(product.price, product.currency)}</div>
      <div>${product.description || ""}</div>
      <div class="meta">${product.stock_qty ?? 0} in stock - Rating ${product.rating ?? "n/a"}</div>
      <div class="tags">${product.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
    `;
    loadProductRecommendations(productId);
  } catch (error) {
    el.detail.classList.add("empty");
    el.detail.textContent = error.message;
  }
}

async function loadProductRecommendations(productId) {
  setStatus(el.recommendationStatus, "Loading product recommendations...");
  try {
    const body = await request(`/products/${productId}/recommendations?limit=6`);
    renderRecommendations(body.results, `Product recs for ${productId}`);
  } catch (error) {
    setStatus(el.recommendationStatus, error.message, true);
  }
}

async function loadCartRecommendations() {
  if (!state.cartId) {
    setStatus(el.recommendationStatus, "Create a cart first.", true);
    return;
  }
  setStatus(el.recommendationStatus, "Loading cart recommendations...");
  try {
    const body = await request(`/carts/${state.cartId}/recommendations?limit=6`);
    renderRecommendations(body.results, `Cart recs for ${state.cartId}`);
  } catch (error) {
    setStatus(el.recommendationStatus, error.message, true);
  }
}

function renderRecommendations(results, label) {
  setStatus(el.recommendationStatus, `${label}: ${results.length} result${results.length === 1 ? "" : "s"}`);
  el.recommendations.classList.remove("empty");
  if (!results.length) {
    el.recommendations.innerHTML = '<div class="empty">No recommendations</div>';
    return;
  }
  el.recommendations.innerHTML = results
    .map(
      (product) => `
        <article class="recommendation">
          <div class="result-main">
            <div class="name">${product.name}</div>
            <div class="meta">${product.id} - ${money(product.price, product.currency)} - ${product.stock_qty ?? 0} in stock</div>
            <div class="tags">${product.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
          </div>
          <div class="actions">
            <button class="secondary" type="button" data-detail="${product.id}">View</button>
            <input class="qty" aria-label="Quantity" type="number" min="1" value="1" data-qty="${product.id}" />
            <button type="button" data-add="${product.id}">Add</button>
          </div>
        </article>
      `
    )
    .join("");
}

async function createCart() {
  setStatus(el.cartStatus, "Creating cart...");
  try {
    const cart = await request("/carts", { method: "POST" });
    state.cartId = cart.id;
    renderCart(cart);
    setStatus(el.cartStatus, "Cart ready");
  } catch (error) {
    setStatus(el.cartStatus, error.message, true);
  }
}

async function addToCart(productId) {
  if (!state.cartId) {
    await createCart();
  }

  const qtyInput = document.querySelector(`[data-qty="${productId}"]`);
  const quantity = Number(qtyInput?.value || 1);
  setStatus(el.cartStatus, "Adding item...");

  try {
    const cart = await request(`/carts/${state.cartId}/items`, {
      method: "POST",
      body: JSON.stringify({ product_id: productId, quantity }),
    });
    renderCart(cart);
    setStatus(el.cartStatus, "Cart updated");
  } catch (error) {
    setStatus(el.cartStatus, error.message, true);
  }
}

async function updateCartItem(productId) {
  if (!state.cartId) return;

  const qtyInput = document.querySelector(`[data-cart-qty="${productId}"]`);
  const quantity = Number(qtyInput?.value || 1);
  setStatus(el.cartStatus, "Updating item...");

  try {
    const cart = await request(`/carts/${state.cartId}/items/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity }),
    });
    renderCart(cart);
    setStatus(el.cartStatus, "Cart updated");
  } catch (error) {
    setStatus(el.cartStatus, error.message, true);
  }
}

async function removeCartItem(productId) {
  if (!state.cartId) return;

  setStatus(el.cartStatus, "Removing item...");

  try {
    const cart = await request(`/carts/${state.cartId}/items/${productId}`, {
      method: "DELETE",
    });
    renderCart(cart);
    setStatus(el.cartStatus, "Item removed");
  } catch (error) {
    setStatus(el.cartStatus, error.message, true);
  }
}

function renderCart(cart) {
  state.cartId = cart.id;
  el.cartId.textContent = cart.id;
  el.cart.classList.remove("empty");

  if (!cart.items.length) {
    el.cart.innerHTML = `
      <div class="cart-summary-strip">
        <span>Items: 0</span>
        <span>Currency: n/a</span>
      </div>
      <div class="empty">Cart is empty</div>
    `;
    return;
  }

  el.cart.innerHTML = `
    <div class="cart-summary-strip">
      <span>Items: ${cart.item_count}</span>
      <span>Currency: ${cart.currency || "n/a"}</span>
    </div>
    <div class="cart-lines">
      ${cart.items
        .map(
          (item) => `
            <article class="cart-line">
              <div class="cart-main">
                <div class="name">${item.name}</div>
                <div class="meta">${item.product_id} - ${item.quantity} x ${money(item.unit_price, item.currency)}</div>
                <div class="meta">Stock: ${item.stock_qty ?? "n/a"} - Available: ${item.available ? "yes" : "no"}</div>
              </div>
              <div class="cart-line-actions">
                <strong class="line-total">${money(item.line_total, item.currency)}</strong>
                <label class="cart-qty-label">
                  Qty
                  <input class="qty" aria-label="Cart quantity for ${item.name}" type="number" min="1" value="${item.quantity}" data-cart-qty="${item.product_id}" />
                </label>
                <button class="secondary" type="button" data-update-cart="${item.product_id}">PATCH qty</button>
                <button class="danger" type="button" data-remove-cart="${item.product_id}">DELETE</button>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
    <div class="cart-total">
      <span>Total</span>
      <span>${money(cart.subtotal, cart.currency)}</span>
    </div>
  `;
}

el.searchForm.addEventListener("submit", searchProducts);
el.createCart.addEventListener("click", createCart);
el.cartRecommendations.addEventListener("click", loadCartRecommendations);
el.results.addEventListener("click", (event) => {
  const detailId = event.target.dataset.detail;
  const addId = event.target.dataset.add;
  if (detailId) showProduct(detailId);
  if (addId) addToCart(addId);
});
el.recommendations.addEventListener("click", (event) => {
  const detailId = event.target.dataset.detail;
  const addId = event.target.dataset.add;
  if (detailId) showProduct(detailId);
  if (addId) addToCart(addId);
});
el.cart.addEventListener("click", (event) => {
  const updateId = event.target.dataset.updateCart;
  const removeId = event.target.dataset.removeCart;
  if (updateId) updateCartItem(updateId);
  if (removeId) removeCartItem(removeId);
});

searchProducts();
