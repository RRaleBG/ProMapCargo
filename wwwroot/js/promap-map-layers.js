(() => {
  "use strict";

  window.ProMap = window.ProMap || {};

  const DEFAULTS = {
    proxyTemplate: "/api/map/tiles/{layer}/{z}/{x}/{y}.png",
    configUrl: "/api/map/config",
    defaultBase: "osm",
    maxZoom: 19,
  };

  /*
   * ============================================================
   * CANONICAL MAP LAYERS
   * ============================================================
   *
   * Base:
   *   1. OSM Light
   *   2. TomTom Dark
   *   3. Satellite
   *
   * Overlay:
   *   4. Traffic Flow
   *   5. Traffic Incidents
   *
   * OSM Light is the only direct browser-to-provider layer.
   *
   * All TomTom/Esri proxy layers go through:
   *
   *   /api/map/tiles/{layer}/{z}/{x}/{y}.png
   *
   * The TomTom API key therefore never reaches the browser.
   */

  const OSM_LIGHT = {
    id: "osm",
    label: "OSM Light",
    type: "base",
    enabled: true,
    maxZoom: 19,
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  };

  const CANONICAL_LAYERS = {
    dark: {
      id: "dark",
      label: "TomTom Dark",
      type: "base",
      enabled: true,
      proxy: true,
      maxZoom: 19,
      attribution: "© TomTom",
    },

    satellite: {
      id: "satellite",
      label: "Satellite",
      type: "base",
      enabled: true,
      proxy: true,
      maxZoom: 19,
      attribution: "Tiles © Esri",
    },

    flow: {
      id: "flow",
      label: "Traffic Flow",
      type: "overlay",
      enabled: true,
      proxy: true,
      maxZoom: 19,
      attribution: "© TomTom",
    },

    incidents: {
      id: "incidents",
      label: "Traffic Incidents",
      type: "overlay",
      enabled: true,
      proxy: true,
      maxZoom: 19,
      attribution: "© TomTom",
    },
  };

  let configPromise = null;
  let mapHookInstalled = false;

  /*
   * ------------------------------------------------------------
   * Proxy URL
   * ------------------------------------------------------------
   */

  function normalizeProxyTemplate(value) {
    const raw = String(value || "").trim();

    if (!raw) {
      return DEFAULTS.proxyTemplate;
    }

    if (raw === "/api/map" || raw === "/api/map/") {
      return DEFAULTS.proxyTemplate;
    }

    if (
      raw.includes("{layer}") &&
      raw.includes("{z}") &&
      raw.includes("{x}") &&
      raw.includes("{y}")
    ) {
      return raw;
    }

    return `${raw.replace(/\/+$/, "")}/tiles/{layer}/{z}/{x}/{y}.png`;
  }

  function proxyTileUrl(template, layer, coords) {
    return template
      .replace("{layer}", encodeURIComponent(layer))
      .replace("{z}", String(coords.z))
      .replace("{x}", String(coords.x))
      .replace("{y}", String(coords.y));
  }

  /*
   * ------------------------------------------------------------
   * Map root / options
   * ------------------------------------------------------------
   */

  function getRootForMap(map) {
    if (!map) {
      return document.body;
    }

    const container =
      typeof map.getContainer === "function" ? map.getContainer() : null;

    if (!container) {
      return document.body;
    }

    return container.closest("[data-map-layers]") || container;
  }

  function optionsFrom(root) {
    const element = root || document.body;

    return {
      proxyTemplate: normalizeProxyTemplate(
        element.dataset?.mapProxy || DEFAULTS.proxyTemplate,
      ),

      configUrl: element.dataset?.mapConfig || DEFAULTS.configUrl,

      defaultBase: String(
        element.dataset?.mapDefaultBase || DEFAULTS.defaultBase,
      ).toLowerCase(),

      maxZoom: Number(element.dataset?.mapMaxZoom || DEFAULTS.maxZoom),
    };
  }

  /*
   * ------------------------------------------------------------
   * Backend map configuration
   * ------------------------------------------------------------
   */

  async function loadConfig(url) {
    const endpoint = url || DEFAULTS.configUrl;

    if (!configPromise) {
      configPromise = fetch(endpoint, {
        method: "GET",

        headers: {
          Accept: "application/json",
        },

        credentials: "same-origin",

        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Map configuration HTTP ${response.status}`);
          }

          return await response.json();
        })
        .catch((error) => {
          configPromise = null;
          throw error;
        });
    }

    return configPromise;
  }

  /*
   * ------------------------------------------------------------
   * Layer definition merging
   * ------------------------------------------------------------
   *
   * Backend configuration controls availability of TomTom.
   *
   * We NEVER invent a different layer name.
   *
   * Canonical IDs are:
   *
   *   osm
   *   dark
   *   satellite
   *   flow
   *   incidents
   */

  function mergeLayerDefinitions(config) {
    const backendLayers = Array.isArray(config?.layers) ? config.layers : [];

    const backendById = new Map();

    for (const definition of backendLayers) {
      if (!definition?.id) {
        continue;
      }

      backendById.set(String(definition.id).toLowerCase(), definition);
    }

    const result = [];

    /*
     * OSM Light
     *
     * Always enabled.
     */

    result.push({
      ...OSM_LIGHT,
    });

    /*
     * Exact canonical order.
     */

    for (const id of ["dark", "satellite", "flow", "incidents"]) {
      const canonical = CANONICAL_LAYERS[id];

      const backend = backendById.get(id);

      /*
       * If backend has a definition,
       * use its enabled state and
       * configuration metadata.
       *
       * If backend doesn't return one,
       * keep the canonical layer available
       * so the frontend still knows the
       * exact layer endpoint.
       */

      const definition = {
        ...canonical,
        ...(backend || {}),
      };

      /*
       * The four configured server layers
       * must always use the proxy.
       */

      definition.id = id;
      definition.proxy = true;
      definition.url = undefined;

      /*
       * Satellite is always available.
       *
       * TomTom layers depend on backend
       * configuration / API key.
       */

      if (id === "satellite") {
        definition.enabled = true;
      }

      result.push(definition);
    }

    return result;
  }

  /*
   * ------------------------------------------------------------
   * Leaflet layer creation
   * ------------------------------------------------------------
   */

  function createExternalLayer(definition) {
    const maxZoom = Number(definition.maxZoom || 19);

    return L.tileLayer(definition.url, {
      maxZoom,

      maxNativeZoom: maxZoom,

      tileSize: 256,

      updateWhenIdle: true,

      updateWhenZooming: false,

      keepBuffer: 2,

      attribution: definition.attribution || "",
    });
  }

  function createProxyLayer(definition, options) {
    const maxZoom = Math.min(
      Number(definition.maxZoom || options.maxZoom || 19),
      Number(options.maxZoom || 19),
    );

    /*
     * IMPORTANT:
     *
     * Do not use the provider URL here.
     *
     * The browser gets:
     *
     * /api/map/tiles/dark/...
     * /api/map/tiles/satellite/...
     * /api/map/tiles/flow/...
     * /api/map/tiles/incidents/...
     */

    const layer = L.tileLayer("about:blank", {
      maxZoom,

      maxNativeZoom: maxZoom,

      tileSize: 256,

      updateWhenIdle: true,

      updateWhenZooming: false,

      keepBuffer: 2,

      attribution: definition.attribution || "ProMap Cargo",
    });

    layer.getTileUrl = (coords) =>
      proxyTileUrl(options.proxyTemplate, definition.id, coords);

    /*
     * Keep Leaflet's internal URL
     * consistent with the real proxy.
     */

    layer._url = options.proxyTemplate;

    layer.__proMapLayerId = String(definition.id).toLowerCase();

    layer.__proMapProxy = true;

    return layer;
  }

  function createLayer(definition, options) {
    if (definition.url && !definition.proxy) {
      return createExternalLayer(definition);
    }

    return createProxyLayer(definition, options);
  }

  /*
   * ------------------------------------------------------------
   * Legacy layer cleanup
   * ------------------------------------------------------------
   *
   * Old pages may create:
   *
   * OSM
   * CARTO
   * /api/map
   *
   * Remove them before installing
   * the central layer system.
   */

  function isLegacyMapTileLayer(layer) {
    if (!layer) {
      return false;
    }

    const url = String(layer._url || "").toLowerCase();

    if (!url) {
      return false;
    }

    return (
      url.includes("tile.openstreetmap.org") ||
      url.includes("basemaps.cartocdn.com") ||
      url === "/api/map" ||
      url.startsWith("/api/map?")
    );
  }

  function removeLegacyLayers(map) {
    const remove = [];

    map.eachLayer((layer) => {
      if (isLegacyMapTileLayer(layer)) {
        remove.push(layer);
      }
    });

    for (const layer of remove) {
      map.removeLayer(layer);
    }
  }

  function removeLegacyLayerControls(map) {
    const container = map.getContainer?.();

    if (!container) {
      return;
    }

    const controls = container.querySelectorAll(".leaflet-control-layers");

    for (const control of controls) {
      control.remove();
    }
  }

  /*
   * ------------------------------------------------------------
   * Base layers
   * ------------------------------------------------------------
   */

  function buildBaseLayers(definitions, options) {
    const base = {};
    const created = {};

    for (const definition of definitions) {
      if (definition.type !== "base") {
        continue;
      }

      if (definition.enabled === false) {
        continue;
      }

      const id = String(definition.id).toLowerCase();

      const layer = createLayer(definition, options);

      created[id] = layer;

      base[definition.label || definition.id] = layer;
    }

    /*
     * Safety guarantee:
     *
     * OSM Light must always exist.
     */

    if (!base["OSM Light"]) {
      const osm = createExternalLayer(OSM_LIGHT);

      created.osm = osm;

      base["OSM Light"] = osm;
    }

    /*
     * Safety guarantee:
     *
     * Satellite must always exist.
     */

    if (!base["Satellite"]) {
      const satellite = createProxyLayer(CANONICAL_LAYERS.satellite, options);

      created.satellite = satellite;

      base["Satellite"] = satellite;
    }

    return {
      base,
      created,
    };
  }

  /*
   * ------------------------------------------------------------
   * Traffic overlays
   * ------------------------------------------------------------
   *
   * These are REAL Leaflet TileLayers.
   *
   * Traffic Flow:
   *   /api/map/tiles/flow/{z}/{x}/{y}.png
   *
   * Traffic Incidents:
   *   /api/map/tiles/incidents/{z}/{x}/{y}.png
   */

  function buildOverlays(definitions, options, created) {
    const overlays = {};

    for (const definition of definitions) {
      if (definition.type !== "overlay") {
        continue;
      }

      if (definition.enabled === false) {
        continue;
      }

      const id = String(definition.id).toLowerCase();

      const tileLayer = createLayer(definition, options);

      tileLayer.__proMapOverlay = true;

      tileLayer.__proMapLayerId = id;

      created[id] = tileLayer;

      overlays[definition.label || definition.id] = tileLayer;
    }

    return overlays;
  }

  /*
   * ------------------------------------------------------------
   * Default base selection
   * ------------------------------------------------------------
   */

  function selectDefaultBase(base, options) {
    const wanted = String(options.defaultBase || "osm").toLowerCase();

    if (wanted === "satellite" && base["Satellite"]) {
      return base["Satellite"];
    }

    if (
      (wanted === "dark" || wanted === "tomtom-dark") &&
      base["TomTom Dark"]
    ) {
      return base["TomTom Dark"];
    }

    /*
     * OSM Light is the universal fallback.
     */

    if (base["OSM Light"]) {
      return base["OSM Light"];
    }

    if (base["Satellite"]) {
      return base["Satellite"];
    }

    return Object.values(base)[0] || null;
  }

  /*
   * ------------------------------------------------------------
   * Attach central map layer system
   * ------------------------------------------------------------
   */

  async function attach(map, userOptions = {}) {
    if (!map || !window.L) {
      return null;
    }

    /*
     * Prevent duplicate initialization.
     */

    if (map.__proMapLayersPromise) {
      return map.__proMapLayersPromise;
    }

    const root = userOptions.root || getRootForMap(map);

    const options = {
      ...optionsFrom(root),
      ...userOptions,
    };

    map.__proMapLayersPromise = (async () => {
      let config;

      try {
        config = await loadConfig(options.configUrl);
      } catch (error) {
        console.warn(
          "ProMap map configuration unavailable. OSM/Satellite will remain available.",
          error,
        );

        config = {
          layers: [],
        };
      }

      /*
       * Build EXACT canonical layer set.
       */

      const definitions = mergeLayerDefinitions(config);

      /*
       * Remove legacy page layers.
       */

      removeLegacyLayers(map);

      removeLegacyLayerControls(map);

      /*
       * Build BASE:
       *
       * OSM Light
       * TomTom Dark
       * Satellite
       */

      const { base, created } = buildBaseLayers(definitions, options);

      /*
       * Build OVERLAYS:
       *
       * Traffic Flow
       * Traffic Incidents
       */

      const overlays = buildOverlays(definitions, options, created);

      /*
       * Remove any legacy layers
       * one more time.
       */

      removeLegacyLayers(map);

      /*
       * Select initial base layer.
       */

      const selected = selectDefaultBase(base, options);

      if (selected) {
        selected.addTo(map);
      }

      /*
       * Single central Leaflet
       * Layer Control.
       */

      const control = L.control.layers(base, overlays, {
        collapsed: true,

        position: "topright",
      });

      control.addTo(map);

      /*
       * Expose everything for:
       *
       * navigation.js
       * dispatch.js
       * monitoring.js
       * dashboard.js
       */

      const result = {
        map,
        base,
        overlays,
        created,
        definitions,
        config,
        options,
        control,
      };

      map.__proMapLayers = result;

      /*
       * Diagnostic information.
       */

      console.info("ProMap map layers loaded:", {
        base: Object.keys(base),

        overlays: Object.keys(overlays),
      });

      return result;
    })();

    return map.__proMapLayersPromise;
  }

  /*
   * ------------------------------------------------------------
   * Leaflet map hook
   * ------------------------------------------------------------
   *
   * Every L.map() automatically receives
   * the central ProMap layer system.
   */

  function installMapHook() {
    if (mapHookInstalled || !window.L || typeof L.map !== "function") {
      return;
    }

    mapHookInstalled = true;

    const originalMap = L.map;

    L.map = function (...args) {
      const map = originalMap.apply(this, args);

      /*
       * Wait one microtask so
       * page-specific map code
       * has time to finish creating
       * its old layers.
       */

      Promise.resolve()
        .then(() => attach(map))
        .catch((error) =>
          console.error(
            "ProMap central map layer initialization failed.",
            error,
          ),
        );

      return map;
    };
  }

  /*
   * ------------------------------------------------------------
   * Public API
   * ------------------------------------------------------------
   */

  function initialize() {
    if (!window.L) {
      console.error("ProMap map layers: Leaflet nije učitan.");

      return;
    }

    installMapHook();
  }

  window.ProMap.MapLayers = {
    attach,
    loadConfig,

    createTileLayer: (definition, options = {}) => {
      const normalizedOptions = {
        ...options,

        proxyTemplate: normalizeProxyTemplate(
          options.proxyTemplate || DEFAULTS.proxyTemplate,
        ),
      };

      return createLayer(definition, normalizedOptions);
    },
  };

  initialize();
})();
