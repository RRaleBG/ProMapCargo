(() => {
    "use strict";

    window.ProMap = window.ProMap || {};

    const DEFAULTS = {
        proxyTemplate: "/api/map/tiles/{layer}/{z}/{x}/{y}.png",
        configUrl: "/api/map/config",
        defaultBase: "dark",
        maxZoom: 19
    };

    const OSM_LIGHT = {
        id: "osm-light",
        label: "OSM Light",
        type: "base",
        maxZoom: 19,
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: "© OpenStreetMap contributors"
    };

    const CARTO_DARK = {
        id: "carto-dark",
        label: "Dark Map",
        type: "base",
        maxZoom: 20,
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attribution: "© OpenStreetMap contributors © CARTO",
        subdomains: "abcd"
    };

    const definitions = new Map();
    let configPromise = null;

    function rootElement(root) {
        return root || document.querySelector("[data-map-layers]") || document.body;
    }

    function optionsFrom(root) {
        return {
            proxyTemplate: root.dataset.mapProxy || DEFAULTS.proxyTemplate,
            configUrl: root.dataset.mapConfig || DEFAULTS.configUrl,
            defaultBase: (root.dataset.mapDefaultBase || DEFAULTS.defaultBase).toLowerCase(),
            maxZoom: Number(root.dataset.mapMaxZoom || DEFAULTS.maxZoom)
        };
    }

    async function loadConfig(url) {
        if (!configPromise) {
            configPromise = fetch(url || DEFAULTS.configUrl, {
                method: "GET",
                headers: { Accept: "application/json" },
                credentials: "same-origin",
                cache: "no-store"
            }).then(async response => {
                if (!response.ok) {
                    throw new Error(`Map configuration HTTP ${response.status}`);
                }
                return response.json();
            }).catch(error => {
                configPromise = null;
                throw error;
            });
        }

        return configPromise;
    }

    function proxyTemplateUrl(template, layer, coords) {
        return template
            .replace("{layer}", encodeURIComponent(layer))
            .replace("{z}", String(coords.z))
            .replace("{x}", String(coords.x))
            .replace("{y}", String(coords.y));
    }

    function proxyLayer(definition, options) {
        const maxZoom = Math.min(
            Number(definition.maxZoom || options.maxZoom),
            options.maxZoom
        );

        const layer = L.tileLayer(options.proxyTemplate, {
            maxZoom,
            maxNativeZoom: maxZoom,
            tileSize: 256,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1,
            attribution: definition.attribution || "TomTom"
        });

        layer.getTileUrl = coords =>
            proxyTemplateUrl(options.proxyTemplate, definition.id, coords);

        return layer;
    }

    function externalLayer(definition) {
        return L.tileLayer(definition.url, {
            maxZoom: Number(definition.maxZoom || 19),
            maxNativeZoom: Number(definition.maxZoom || 19),
            tileSize: 256,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1,
            subdomains: definition.subdomains || undefined,
            attribution: definition.attribution || ""
        });
    }

    function build(definition, options) {
        return definition.url
            ? externalLayer(definition)
            : proxyLayer(definition, options);
    }

    async function attach(map, userOptions = {}) {
        if (!map || !window.L) {
            return null;
        }

        const root = rootElement(userOptions.root);
        const options = {
            ...optionsFrom(root),
            ...userOptions
        };

        let config;

        try {
            config = await loadConfig(options.configUrl);
        } catch (error) {
            console.warn("ProMap map configuration unavailable.", error);
            config = { layers: [] };
        }

        definitions.clear();
        definitions.set(OSM_LIGHT.id, OSM_LIGHT);
        definitions.set(CARTO_DARK.id, CARTO_DARK);

        for (const definition of config.layers || []) {
            if (definition?.id) {
                definitions.set(String(definition.id).toLowerCase(), definition);
            }
        }

        const base = {};
        const overlays = {};
        const created = {};

        const addBase = definition => {
            const label = definition.label || definition.id;

            if (!created[definition.id]) {
                created[definition.id] = build(definition, options);
            }

            base[label] = created[definition.id];
        };

        addBase(OSM_LIGHT);

        for (const definition of config.layers || []) {
            if (definition?.enabled && definition.type === "base") {
                addBase(definition);
            }
        }

        if (!base["Dark Map"]) {
            addBase(CARTO_DARK);
        }

        for (const definition of config.layers || []) {
            if (!definition?.enabled || definition.type !== "overlay") {
                continue;
            }

            const label = definition.label || definition.id;
            let tile = null;

            overlays[label] = L.layerGroup();

            overlays[label].on("add", () => {
                if (!tile) {
                    tile = build(definition, options);
                    created[definition.id] = tile;
                }

                if (!map.hasLayer(tile)) {
                    tile.addTo(map);
                }
            });

            overlays[label].on("remove", () => {
                if (tile && map.hasLayer(tile)) {
                    map.removeLayer(tile);
                }
            });
        }

        let selected = null;
        const wanted = options.defaultBase;

        if (wanted === "osm" || wanted === "osm-light") {
            selected = base["OSM Light"];
        } else if (wanted === "dark" || wanted === "tomtom-dark") {
            selected = base["TomTom Dark"] || base["Dark Map"];
        } else if (wanted === "satellite") {
            selected = base["Satellite"];
        }

        selected ||= Object.values(base)[0] || null;

        if (selected) {
            selected.addTo(map);
        }

        const control = L.control.layers(base, overlays, {
            collapsed: true,
            position: "topright"
        }).addTo(map);

        return { base, overlays, created, config, control };
    }

    function getLayer(collection, id) {
        if (!collection) {
            return null;
        }

        const wanted = String(id).toLowerCase();
        const definition = definitions.get(wanted);

        if (definition) {
            const label = definition.label || definition.id;
            if (collection[label]) {
                return collection[label];
            }
        }

        return Object.entries(collection)
            .find(([label]) => label.toLowerCase() === wanted)?.[1] || null;
    }

    window.ProMap.MapLayers = {
        attach,
        loadConfig,
        getLayer,
        createTileLayer(definition, options = optionsFrom(rootElement())) {
            if (!window.L) {
                throw new Error("Leaflet nije učitan.");
            }

            return build(definition, options);
        }
    };
})();