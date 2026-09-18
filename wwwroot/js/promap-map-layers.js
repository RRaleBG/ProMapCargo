(() => {
  "use strict";

  window.ProMap = window.ProMap || {};

  const DEFAULTS = {
    proxyTemplate: "/api/map/tiles/{layer}/{z}/{x}/{y}.png",
    configUrl: "/api/map/config",
    defaultBase: "osm",
    maxZoom: 19,
  };

  const OSM_LIGHT = {
    id: "osm",
    label: "OSM Light",
    type: "base",
    enabled: true,
    maxZoom: 19,
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  };

  let configPromise = null;
  let mapHookInstalled = false;

  function normalizeProxyTemplate(value) {
    const raw = String(value || "").trim();

    if (!raw) {
      return DEFAULTS.proxyTemplate;
    }

    /*
     * Backward compatibility:
     *
     * Existing pages currently use:
     *
     *     data-map-proxy="/api/map"
     *
     * The real endpoint is:
     *
     *     /api/map/tiles/{layer}/{z}/{x}/{y}.png
     */
    if (raw === "/api/map" || raw === "/api/map/") {
      return DEFAULTS.proxyTemplate;
    }

    /*
     * Accept a complete template directly.
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
     * Accept a custom controller base.
     */
    return `${raw.replace(/\/+$/, "")}/tiles/{layer}/{z}/{x}/{y}.png`;
  }

  function getRootForMap(map) {
    if (!map) {
      return document.body;
    }

    const container = map.getContainer?.();

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

          return response.json();
        })
        .catch((error) => {
          configPromise = null;

          throw error;
        });
    }

    return configPromise;
  }

  function proxyTileUrl(template, layer, coords) {
    return template
      .replace("{layer}", encodeURIComponent(layer))
      .replace("{z}", String(coords.z))
      .replace("{x}", String(coords.x))
      .replace("{y}", String(coords.y));
  }

  function createProxyLayer(definition, options) {
    const maxZoom = Math.min(
      Number(definition.maxZoom || options.maxZoom || 19),
      Number(options.maxZoom || 19),
    );

    const layer = L.tileLayer(options.proxyTemplate, {
      maxZoom,
      maxNativeZoom: maxZoom,

      tileSize: 256,

      updateWhenIdle: true,
      updateWhenZooming: false,

      keepBuffer: 2,

      attribution: definition.attribution || "ProMap Cargo",
    });

    /*
     * Leaflet calls getTileUrl() when
     * creating each tile.
     *
     * This means the browser receives only:
     *
     * /api/map/tiles/...
     *
     * and never receives the TomTom key.
     */
    layer.getTileUrl = (coords) =>
      proxyTileUrl(options.proxyTemplate, definition.id, coords);

    return layer;
  }

  function createExternalLayer(definition) {
    return L.tileLayer(definition.url, {
      maxZoom: Number(definition.maxZoom || 19),
      maxNativeZoom: Number(definition.maxZoom || 19),
      tileSize: 256,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 2,
      attribution: definition.attribution || "",
    });
  }

  function createLayer(definition, options) {
    if (definition.url && !definition.proxy) {
      return createExternalLayer(definition);
    }

    return createProxyLayer(definition, options);
  }

  function isLegacyMapTileLayer(layer) {
    if (!layer) {
      return false;
    }

    const url = String(layer._url || "").toLowerCase();

    if (!url) {
      return false;
    }

    /*
     * Remove old OSM/CARTO base
     * layers created by page-specific
     * legacy code.
     */
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

    /*
     * Old page-specific
     * L.control.layers(...)
     * controls.
     */
    const controls = container.querySelectorAll(".leaflet-control-layers");

    for (const control of controls) {
      control.remove();
    }
  }

  function buildBaseLayers(map, config, options) {
    const base = {};
    const created = {};

    /*
     * OSM is ALWAYS available.
     *
     * This is the important fallback.
     *
     * We do NOT fall back to CARTO.
     */
    created.osm = createExternalLayer(OSM_LIGHT);

    base["OSM Light"] = created.osm;

    for (const definition of config.layers || []) {
      if (
        !definition ||
        !definition.id ||
        definition.type !== "base" ||
        !definition.enabled
      ) {
        continue;
      }

      const id = String(definition.id).toLowerCase();

      /*
       * Do not duplicate OSM.
       */
      if (id === "osm" || id === "osm-light") {
        continue;
      }

      const layer = createLayer(definition, options);

      created[id] = layer;

      base[definition.label || definition.id] = layer;
    }

    /*
     * Satellite is available from the
     * server-side proxy even without TomTom.
     */
    if (!created.satellite) {
      const satellite = {
        id: "satellite",
        label: "Satellite",
        type: "base",
        enabled: true,
        maxZoom: 19,
        proxy: true,
        attribution: "Tiles © Esri",
      };

      created.satellite = createProxyLayer(satellite, options);

      base["Satellite"] = created.satellite;
    }

    return {
      base,
      created,
    };
  }

  function buildOverlays(map, config, options, created) {
    const overlays = {};

    for (const definition of config.layers || []) {
      if (
        !definition ||
        !definition.id ||
        definition.type !== "overlay" ||
        !definition.enabled
      ) {
        continue;
      }

      const id = String(definition.id).toLowerCase();

      const label = definition.label || definition.id;

      const group = L.layerGroup();

      let tileLayer = null;

      group.on("add", () => {
        if (!tileLayer) {
          tileLayer = createLayer(definition, options);

          created[id] = tileLayer;
        }

        if (!map.hasLayer(tileLayer)) {
          tileLayer.addTo(map);
        }
      });

      group.on("remove", () => {
        if (tileLayer && map.hasLayer(tileLayer)) {
          map.removeLayer(tileLayer);
        }
      });

      overlays[label] = group;
    }

    return overlays;
  }

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
     * If TomTom Dark is not configured,
     * ALWAYS use OSM.
     */
    if (wanted === "dark" || wanted === "tomtom-dark") {
      return base["OSM Light"] || base["Satellite"] || null;
    }

    return (
      base["OSM Light"] || base["Satellite"] || Object.values(base)[0] || null
    );
  }

  async function attach(map, userOptions = {}) {
    if (!map || !window.L) {
      return null;
    }

    /*
     * Prevent duplicate central
     * layer systems.
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
          "ProMap map configuration unavailable. OSM will be used.",
          error,
        );

        /*
         * Even if /api/map/config
         * is unavailable, the map MUST
         * still show OSM.
         */
        config = {
          layers: [],
        };
      }

      /*
       * Remove old page-specific
       * OSM/CARTO/API base layers.
       */
      removeLegacyLayers(map);

      /*
       * Remove old layer controls.
       */
      removeLegacyLayerControls(map);

      const { base, created } = buildBaseLayers(map, config, options);

      const overlays = buildOverlays(map, config, options, created);

      /*
       * Make sure all currently
       * active legacy tile layers
       * are gone before selecting
       * our base.
       */
      removeLegacyLayers(map);

      const selected = selectDefaultBase(base, options);

      if (selected) {
        selected.addTo(map);
      }

      const control = L.control.layers(base, overlays, {
        collapsed: true,
        position: "topright",
      });

      control.addTo(map);

      /*
       * Expose the central map system
       * to navigation/dispatch/monitoring.
       */
      const result = {
        map,
        base,
        overlays,
        created,
        config,
        options,
        control,
      };

      map.__proMapLayers = result;

      return result;
    })();

    return map.__proMapLayersPromise;
  }

  function installMapHook() {
    if (mapHookInstalled || !window.L || typeof L.map !== "function") {
      return;
    }

    mapHookInstalled = true;

    const originalMap = L.map;

    L.map = function (...args) {
      const map = originalMap.apply(this, args);

      /*
       * Existing page code creates
       * its own OSM/CARTO layer
       * immediately after L.map().
       *
       * Wait one microtask so that
       * legacy code finishes, then
       * central integration removes
       * those layers and installs
       * the real layer system.
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

    /*
     * Expose manual attach as well.
     */
    window.ProMap.MapLayers = window.ProMap.MapLayers || {};

    window.ProMap.MapLayers.attach = attach;

    window.ProMap.MapLayers.loadConfig = loadConfig;

    window.ProMap.MapLayers.createTileLayer = (definition, options = {}) => {
      const normalizedOptions = {
        ...options,
        proxyTemplate: normalizeProxyTemplate(
          options.proxyTemplate || DEFAULTS.proxyTemplate,
        ),
      };

      return createLayer(definition, normalizedOptions);
    };
  }

  function initialize() {
    if (!window.L) {
      console.error("ProMap map layers: Leaflet nije učitan.");

      return;
    }

    installMapHook();
  }

  /*
   * Leaflet is loaded before this script
   * from _Layout.cshtml.
   */
  initialize();
})();
