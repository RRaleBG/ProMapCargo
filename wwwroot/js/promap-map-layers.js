(() => {
    "use strict";

    window.ProMap = window.ProMap || {};

    const DEFAULTS = {
        proxyTemplate: "/api/map/tiles/{layer}/{z}/{x}/{y}.png",
        configUrl: "/api/map/config",
        defaultBase: "dark",
        lazy: true,
        maxZoom: 19
    };

    const layerDefinitions = new Map();
    let configPromise = null;

    function getRoot() {
        return document.querySelector("[data-map-layers]") || document.body;
    }

    function readOptions(root = getRoot()) {
        return {
            proxyTemplate: root.dataset.mapProxy || DEFAULTS.proxyTemplate,
            configUrl: root.dataset.mapConfig || DEFAULTS.configUrl,
            defaultBase: root.dataset.mapDefaultBase || DEFAULTS.defaultBase,
            lazy: root.dataset.mapLazy !== "false",
            maxZoom: Number(root.dataset.mapMaxZoom || DEFAULTS.maxZoom)
        };
    }

    async function loadConfig(url) {
        if (!configPromise) {
            configPromise = fetch(url, {
                method: "GET",
                headers: { Accept: "application/json" },
                credentials: "same-origin",
                cache: "no-store"
            }).then(async response => {
                if (!response.ok) {
                    throw new Error(`Map config HTTP ${response.status}`);
                }

                return response.json();
            }).catch(error => {
                configPromise = null;
                throw error;
            });
        }

        return configPromise;
    }

    function proxyUrl(template, layer, coords) {
        return template
            .replace("{layer}", encodeURIComponent(layer))
            .replace("{z}", String(coords.z))
            .replace("{x}", String(coords.x))
            .replace("{y}", String(coords.y));
    }

    function createTileLayer(layer, options) {
        if (!window.L) {
            throw new Error("Leaflet nije učitan.");
        }

        const definition = layerDefinitions.get(layer);
        if (!definition) {
            throw new Error(`Map layer '${layer}' nije konfigurisan.`);
        }

        const tile = L.tileLayer(options.proxyTemplate, {
            maxZoom: definition.id === "satellite" ? 19 : options.maxZoom,
            maxNativeZoom: definition.id === "satellite" ? 19 : options.maxZoom,
            tileSize: 256,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1,
            crossOrigin: true,
            attribution: definition.id === "satellite"
                ? "Tiles © Esri"
                : "TomTom"
        });

        tile.getTileUrl = function(coords) {
            return proxyUrl(options.proxyTemplate, definition.id, coords);
        };

        return tile;
    }

    async function prepare(options) {
        const config = await loadConfig(options.configUrl);

        layerDefinitions.clear();

        for (const layer of config.layers || []) {
            if (layer?.id && layer.enabled) {
                layerDefinitions.set(layer.id, layer);
            }
        }

        return config;
    }

    async function attach(map, userOptions = {}) {
        if (!map || !window.L) {
            return null;
        }

        const root = userOptions.root || getRoot();
        const options = { ...readOptions(root), ...userOptions };

        let config;
        try {
            config = await prepare(options);
        } catch (error) {
            console.warn("ProMap map configuration unavailable.", error);
            return null;
        }

        const base = {};
        const overlays = {};
        const created = {};

        for (const definition of config.layers || []) {
            if (!definition?.id || !definition.enabled) {
                continue;
            }

            const create = () => {
                if (!created[definition.id]) {
                    created[definition.id] = createTileLayer(definition.id, options);
                }
                return created[definition.id];
            };

            if (definition.type === "overlay") {
                overlays[definition.label || definition.id] = L.layerGroup();
                overlays[definition.label || definition.id].on("add", () => {
                    const tile = create();
                    if (!map.hasLayer(tile)) {
                        tile.addTo(map);
                    }
                });
                overlays[definition.label || definition.id].on("remove", () => {
                    const tile = created[definition.id];
                    if (tile && map.hasLayer(tile)) {
                        map.removeLayer(tile);
                    }
                });
            } else {
                base[definition.label || definition.id] = create();
            }
        }

        const defaultDefinition = config.layers?.find(
            x => x.id === options.defaultBase && x.enabled && x.type === "base"
        ) || config.layers?.find(x => x.enabled && x.type === "base");

        if (defaultDefinition) {
            const defaultLayer = base[defaultDefinition.label || defaultDefinition.id];
            defaultLayer?.addTo(map);
        }

        if (Object.keys(base).length || Object.keys(overlays).length) {
            L.control.layers(base, overlays, {
                collapsed: true,
                position: "topright"
            }).addTo(map);
        }

        return {
            base,
            overlays,
            created,
            config
        };
    }

    function addConfiguredLayer(map, collection, id) {
        if (!collection || !map) {
            return false;
        }

        for (const [label, layer] of Object.entries(collection)) {
            const definition = layerDefinitions.get(id);
            if (definition && (label === definition.label || label === id)) {
                layer.addTo(map);
                return true;
            }
        }

        return false;
    }

    window.ProMap.MapLayers = {
        attach,
        loadConfig,
        createTileLayer,
        addConfiguredLayer
    };
})();
