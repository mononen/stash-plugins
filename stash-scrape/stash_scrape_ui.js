(function () {
  "use strict";

  const PLUGIN_ID = "stash-scrape";
  const MENU_ITEM_PREFIX = "stash-scrape-menuitem";
  const BULK_BAR_ID = "stash-scrape-bulk-bar";
  const TOAST_ID = "stash-scrape-toast";

  // ---------------------------------------------------------------------------
  // GraphQL
  // ---------------------------------------------------------------------------

  async function callGQL(query, variables) {
    const resp = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const json = await resp.json();
    if (json.errors) throw new Error(json.errors[0].message);
    return json.data;
  }

  async function runPluginTask(taskName, args) {
    return callGQL(
      `mutation RunPluginTask($id: ID!, $task: String!, $args: Map) {
         runPluginTask(plugin_id: $id, task_name: $task, args_map: $args)
       }`,
      { id: PLUGIN_ID, task: taskName, args }
    );
  }

  // ---------------------------------------------------------------------------
  // Toast notification
  // ---------------------------------------------------------------------------

  function showNotification(message, isError = false) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.className = "stash-scrape-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle("stash-scrape-toast-error", isError);
    toast.classList.add("stash-scrape-toast-visible");
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.classList.remove("stash-scrape-toast-visible");
    }, 4000);
  }

  // ---------------------------------------------------------------------------
  // Scene player — inject into the scene operations dropdown
  // ---------------------------------------------------------------------------

  function getSceneIdFromPath() {
    const m = window.location.pathname.match(/\/scene[s]?\/(\d+)/);
    return m ? m[1] : null;
  }

  function removeScrapeMenuItems() {
    document.querySelectorAll(`[id^="${MENU_ITEM_PREFIX}"]`).forEach((el) => el.remove());
  }

  function isSceneOperationsMenu(menu) {
    const text = menu.textContent || "";
    return text.includes("Rescan") && (text.includes("Delete") || text.includes("Generate"));
  }

  function findSceneOperationsDropdown() {
    for (const menu of document.querySelectorAll(".dropdown-menu.show")) {
      if (isSceneOperationsMenu(menu)) return menu;
    }
    return null;
  }

  function makeDropdownItem(id, label, onClick) {
    const li = document.createElement("li");
    li.id = `${MENU_ITEM_PREFIX}-${id}`;
    const a = document.createElement("a");
    a.className = "dropdown-item stash-scrape-menuitem";
    a.href = "#";
    a.textContent = label;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.body.click(); // close dropdown
      onClick();
    });
    li.appendChild(a);
    return li;
  }

  async function addScrapeItemsToMenu(menu) {
    if (!menu || document.getElementById(`${MENU_ITEM_PREFIX}-match`)) return;
    const sceneId = getSceneIdFromPath();
    if (!sceneId) return;

    const matchItem = makeDropdownItem("match", "Match scene (ID only)", async () => {
      try {
        await runPluginTask("Match Single Scene", { scene_id: sceneId });
        showNotification("Match queued — check Tasks for progress");
      } catch (err) {
        showNotification("Failed to start: " + err.message, true);
      }
    });

    const scrapeItem = makeDropdownItem("scrape", "Scrape & save all", async () => {
      try {
        await runPluginTask("Scrape & Save Single Scene", { scene_id: sceneId });
        showNotification("Scrape queued — check Tasks for progress");
      } catch (err) {
        showNotification("Failed to start: " + err.message, true);
      }
    });

    const divider = document.createElement("li");
    divider.id = `${MENU_ITEM_PREFIX}-divider`;
    divider.innerHTML = '<hr class="dropdown-divider">';

    // Insert before the last divider (which precedes Delete) so items feel native
    const dividers = menu.querySelectorAll(".dropdown-divider");
    const anchor = dividers[dividers.length - 1] || null;
    if (anchor) {
      menu.insertBefore(divider, anchor);
      menu.insertBefore(matchItem, anchor);
      menu.insertBefore(scrapeItem, anchor);
    } else {
      menu.appendChild(divider);
      menu.appendChild(matchItem);
      menu.appendChild(scrapeItem);
    }
  }

  function tryInjectScrapeMenuItems() {
    if (!getSceneIdFromPath()) { removeScrapeMenuItems(); return; }
    const menu = findSceneOperationsDropdown();
    if (menu) addScrapeItemsToMenu(menu);
  }

  // ---------------------------------------------------------------------------
  // Scene grid — floating bulk action bar when scenes are selected
  // ---------------------------------------------------------------------------

  function isSceneGridPage() {
    // Matches /scenes, /scenes?..., and also tagged/performer/studio scene lists
    return window.location.pathname.startsWith("/scenes");
  }

  function getSelectedSceneIds() {
    const ids = new Set();
    // Stash adds .selected to scene/grid cards in selection mode
    const cards = document.querySelectorAll(
      ".scene-card.selected, .grid-card.selected, [class*='scene-card'][class*='selected']"
    );
    for (const card of cards) {
      const link = card.querySelector('a[href*="/scenes/"]');
      if (!link) continue;
      const m = (link.getAttribute("href") || "").match(/\/scenes\/(\d+)/);
      if (m) ids.add(m[1]);
    }
    return [...ids];
  }

  function removeBulkBar() {
    document.getElementById(BULK_BAR_ID)?.remove();
  }

  function buildBulkBar() {
    const bar = document.createElement("div");
    bar.id = BULK_BAR_ID;
    bar.className = "stash-scrape-bulk-bar";

    const countLabel = document.createElement("span");
    countLabel.className = "stash-scrape-bulk-count";
    bar.appendChild(countLabel);

    const sep = document.createElement("span");
    sep.className = "stash-scrape-bulk-sep";
    bar.appendChild(sep);

    async function runBulk(taskName, label, btns) {
      const ids = getSelectedSceneIds();
      if (!ids.length) return;
      btns.forEach((b) => (b.disabled = true));
      try {
        await runPluginTask(taskName, { scene_ids: ids });
        showNotification(`${label} ${ids.length} scene(s) — check Tasks for progress`);
      } catch (err) {
        showNotification("Failed to start: " + err.message, true);
      } finally {
        btns.forEach((b) => (b.disabled = false));
      }
    }

    const matchBtn = document.createElement("button");
    matchBtn.className = "btn btn-sm btn-outline-light stash-scrape-bulk-btn";
    matchBtn.textContent = "Match selected";

    const scrapeBtn = document.createElement("button");
    scrapeBtn.className = "btn btn-sm btn-primary stash-scrape-bulk-btn";
    scrapeBtn.textContent = "Scrape & save selected";

    matchBtn.addEventListener("click", () =>
      runBulk("Match Selected", "Matching", [matchBtn, scrapeBtn])
    );
    scrapeBtn.addEventListener("click", () =>
      runBulk("Scrape & Save Selected", "Scraping", [matchBtn, scrapeBtn])
    );

    bar.appendChild(matchBtn);
    bar.appendChild(scrapeBtn);
    document.body.appendChild(bar);
    return { bar, countLabel };
  }

  let _bulkBar = null;

  function updateBulkBar() {
    if (!isSceneGridPage()) { removeBulkBar(); _bulkBar = null; return; }
    const ids = getSelectedSceneIds();
    if (!ids.length) {
      removeBulkBar();
      _bulkBar = null;
      return;
    }
    if (!_bulkBar || !document.getElementById(BULK_BAR_ID)) {
      _bulkBar = buildBulkBar();
    }
    _bulkBar.countLabel.textContent =
      ids.length === 1 ? "1 scene selected" : `${ids.length} scenes selected`;
  }

  // ---------------------------------------------------------------------------
  // SPA navigation & DOM mutation wiring
  // ---------------------------------------------------------------------------

  PluginApi.Event.addEventListener("stash:location", () => {
    removeScrapeMenuItems();
    removeBulkBar();
    _bulkBar = null;
    setTimeout(tryInjectScrapeMenuItems, 300);
  });

  setTimeout(tryInjectScrapeMenuItems, 500);
  setTimeout(updateBulkBar, 500);

  let injectScheduled = false;
  function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    requestAnimationFrame(() => {
      tryInjectScrapeMenuItems();
      updateBulkBar();
      setTimeout(() => { injectScheduled = false; }, 100);
    });
  }

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (
        m.type === "childList" ||
        (m.type === "attributes" && m.attributeName === "class")
      ) {
        scheduleInject();
        break;
      }
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const style = document.createElement("style");
  style.textContent = `
    .stash-scrape-menuitem { cursor: pointer; }

    /* Floating bulk action bar */
    .stash-scrape-bulk-bar {
      position: fixed;
      bottom: 1.75rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.5rem 0.875rem;
      background: var(--bs-dark, #212529);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 2rem;
      box-shadow: 0 0.375rem 1.25rem rgba(0, 0, 0, 0.5);
      z-index: 1050;
      white-space: nowrap;
    }
    .stash-scrape-bulk-count {
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.875rem;
    }
    .stash-scrape-bulk-sep {
      width: 1px;
      height: 1.25rem;
      background: rgba(255, 255, 255, 0.15);
    }
    .stash-scrape-bulk-btn {
      font-size: 0.8125rem;
      border-radius: 1rem;
      padding: 0.25rem 0.75rem;
    }

    /* Toast */
    .stash-scrape-toast {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      padding: 0.75rem 1.25rem;
      background: var(--bs-success, #198754);
      color: #fff;
      border-radius: 0.25rem;
      box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.2);
      z-index: 9999;
      opacity: 0;
      transform: translateY(0.5rem);
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: none;
      max-width: 22rem;
    }
    .stash-scrape-toast.stash-scrape-toast-visible {
      opacity: 1;
      transform: translateY(0);
    }
    .stash-scrape-toast.stash-scrape-toast-error {
      background: var(--bs-danger, #dc3545);
    }
  `;
  document.head.appendChild(style);
})();
