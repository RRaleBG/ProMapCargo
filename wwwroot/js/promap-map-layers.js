(() => {
  "use strict";

  window.ProMap = window.ProMap || {};

  const DEFAULTS = {
    proxyTemplate: "/api/map/tiles/{layer}/{z}/{x}/{y}.png",
    configUrl: "/api/map/config",
    defaultBase: "dark",
    maxZoom: 19,
  };

  /*
   * ============================================================
   * PROMAP CARGO - CENTRAL MAP LAYER SYSTEM
   * ============================================================
   *
   * BASE LAYERS
   * ------------------------------------------------------------
   * 1. TomTom Dark
   * 2. OSM Light
   * 3. Satellite
   *
   * OVERLAYS
   * ------------------------------------------------------------
   * 4. Traffic Flow
   * 5. Traffic Incidents
   *
   * TomTom API key NEVER reaches the browser.
   *
   * Browser requests:
   *
   * /api/map/tiles/dark/{z}/{x}/{y}.png
   * /api/map/tiles/satellite/{z}/{x}/{y}.png
   * /api/map/tiles/flow/{z}/{x}/{y}.png
   * /api/map/tiles/incidents/{z}/{x}/{y}.png
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
   * ============================================================
   * PROXY TEMPLATE
   * ============================================================
   */

  function normalizeProxyTemplate(value) {
    const raw = String(value || "").trim();

    if (!raw) {
      return DEFAULTS.proxyTemplate;
    }

    /*
     * Backward compatibility with existing pages.
     */

    if (raw === "/api/map" || raw === "/api/map/") {
      return DEFAULTS.proxyTemplate;
    }

    /*
     * Complete template.
     */

    if (
      raw.includes("{layer}") &&
      raw.includes("{z}") &&
      raw.includes("{x}") &&
      raw.includes("{y}")
    ) {
      return raw;
    }

    /*
     * Controller base.
     */

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
   * ============================================================
   * MAP OPTIONS
   * ============================================================
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
   * ============================================================
   * BACKEND CONFIG
   * ============================================================
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
   * ============================================================
   * NORMALIZE BACKEND LAYERS
   * ============================================================
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
     */

    result.push({
      ...OSM_LIGHT,
    });

    /*
     * Exact canonical layer order.
     */

    for (const id of ["dark", "satellite", "flow", "incidents"]) {
      const canonical = CANONICAL_LAYERS[id];

      const backend = backendById.get(id);

      const definition = {
        ...canonical,
        ...(backend || {}),
      };

      /*
       * These four layers ALWAYS use
       * the server proxy.
       */

      definition.id = id;
      definition.proxy = true;
      definition.url = undefined;

      /*
       * Satellite is always available.
       */

      if (id === "satellite") {
        definition.enabled = true;
      }

      result.push(definition);
    }

    return result;
  }

  /*
   * ============================================================
   * LEAFLET LAYER CREATION
   * ============================================================
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
     * We intentionally use a dummy URL.
     *
     * getTileUrl() below generates the
     * real ProMap API URL.
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
   * ============================================================
   * REMOVE OLD PAGE-SPECIFIC MAP LAYERS
   * ============================================================
   */

  function isLegacyMapTileLayer(layer) {
    if (!layer) {
      return false;
    }

    /*
     * Never remove our own central proxy layers.
     */

    if (layer.__proMapProxy) {
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
   * ============================================================
   * BASE LAYERS
   * ============================================================
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
     * OSM Light is mandatory.
     */

    if (!base["OSM Light"]) {
      const osm = createExternalLayer(OSM_LIGHT);

      created.osm = osm;

      base["OSM Light"] = osm;
    }

    /*
     * Satellite is mandatory.
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
   * ============================================================
   * TRAFFIC OVERLAYS
   * ============================================================
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
   * ============================================================
   * DEFAULT MAP = TOMTOM DARK
   * ============================================================
   */

  function selectDefaultBase(base, options) {
    const wanted = String(options.defaultBase || "dark").toLowerCase();

    /*
     * TomTom Dark is the default.
     */

    if (
      (wanted === "dark" || wanted === "tomtom-dark") &&
      base["TomTom Dark"]
    ) {
      return base["TomTom Dark"];
    }

    /*
     * Explicit Satellite.
     */

    if (wanted === "satellite" && base["Satellite"]) {
      return base["Satellite"];
    }

    /*
     * Explicit OSM.
     */

    if (wanted === "osm" && base["OSM Light"]) {
      return base["OSM Light"];
    }

    /*
     * Dark fallback.
     */

    if (base["TomTom Dark"]) {
      return base["TomTom Dark"];
    }

    /*
     * OSM fallback.
     */

    if (base["OSM Light"]) {
      return base["OSM Light"];
    }

    /*
     * Satellite fallback.
     */

    if (base["Satellite"]) {
      return base["Satellite"];
    }

    return Object.values(base)[0] || null;
  }

  /*
   * ============================================================
   * ATTACH MAP LAYERS
   * ============================================================
   */

  async function attach(map, userOptions = {}) {
    if (!map || !window.L) {
      return null;
    }

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
        console.warn("ProMap map configuration unavailable.", error);

        config = {
          layers: [],
        };
      }

      /*
       * Build canonical layer set.
       */

      const definitions = mergeLayerDefinitions(config);

      /*
       * Remove old page-specific
       * OSM/CARTO/API layers.
       */

      removeLegacyLayers(map);

      removeLegacyLayerControls(map);

      /*
       * Build base layers.
       */

      const { base, created } = buildBaseLayers(definitions, options);

      /*
       * Build traffic overlays.
       */

      const overlays = buildOverlays(definitions, options, created);

      /*
       * Remove legacy layers again
       * after page scripts finished.
       */

      removeLegacyLayers(map);

      /*
       * DEFAULT = TOMTOM DARK.
       */

      const selected = selectDefaultBase(base, options);

      if (selected) {
        selected.addTo(map);
      }

      /*
       * ONE Layer Control.
       */

      const control = L.control.layers(base, overlays, {
        collapsed: true,

        position: "topright",
      });

      control.addTo(map);

      /*
       * Store central state.
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

      console.info("ProMap map layers loaded:", {
        base: Object.keys(base),

        overlays: Object.keys(overlays),
      });

      return result;
    })();

    return map.__proMapLayersPromise;
  }

  /*
   * ============================================================
   * AUTOMATIC L.MAP() INTEGRATION
   * ============================================================
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
       * Let page-specific map code
       * finish first.
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
   * ============================================================
   * PUBLIC API
   * ============================================================
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
