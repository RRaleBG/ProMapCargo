(() => {
    "use strict";

    window.ProMap = window.ProMap || {};

    const DEFAULTS = {
        proxyTemplate:
            "/api/map/tiles/{layer}/{z}/{x}/{y}.png",

        configUrl:
            "/api/map/config",

        defaultBase:
            "dark",

        maxZoom:
            19
    };

    const OSM_LIGHT = {
        id: "osm",
        label: "OSM Light",
        type: "base",
        enabled: true,
        url:
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        maxZoom: 19,
        attribution:
            "© OpenStreetMap contributors"
    };

    const CANONICAL = {
        dark: {
            id: "dark",
            label: "TomTom Dark",
            type: "base",
            maxZoom: 19,
            attribution: "© TomTom"
        },

        satellite: {
            id: "satellite",
            label: "Satellite",
            type: "base",
            maxZoom: 19,
            attribution: "Tiles © Esri"
        },

        flow: {
            id: "flow",
            label: "Traffic Flow",
            type: "overlay",
            maxZoom: 19,
            attribution: "© TomTom"
        },

        incidents: {
            id: "incidents",
            label: "Traffic Incidents",
            type: "overlay",
            maxZoom: 19,
            attribution: "© TomTom"
        }
    };

    let mapHookInstalled = false;
    let configPromise = null;

    function normalizeTemplate(value) {
        const raw =
            String(value || "").trim();

        if (!raw) {
            return DEFAULTS.proxyTemplate;
        }

        if (
            raw === "/api/map" ||
            raw === "/api/map/"
        ) {
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

        return (
            raw.replace(/\/+$/, "") +
            "/tiles/{layer}/{z}/{x}/{y}.png"
        );
    }

    function getMapContainer(map) {
        if (
            !map ||
            typeof map.getContainer !== "function"
        ) {
            return null;
        }

        return map.getContainer();
    }

    function getMapElement(map) {
        const container =
            getMapContainer(map);

        if (!container) {
            return null;
        }

        return container;
    }

    function getOptions(map) {
        const element =
            getMapElement(map);

        return {
            proxyTemplate:
                normalizeTemplate(
                    element?.dataset?.mapProxy ||
                    DEFAULTS.proxyTemplate
                ),

            configUrl:
                element?.dataset?.mapConfig ||
                DEFAULTS.configUrl,

            defaultBase:
                String(
                    element?.dataset?.mapDefaultBase ||
                    DEFAULTS.defaultBase
                ).toLowerCase(),

            maxZoom:
                Number(
                    element?.dataset?.mapMaxZoom ||
                    DEFAULTS.maxZoom
                )
        };
    }

    async function loadConfig(url) {
        const endpoint =
            url || DEFAULTS.configUrl;

        if (!configPromise) {
            configPromise =
                fetch(
                    endpoint,
                    {
                        method: "GET",
                        headers: {
                            Accept:
                                "application/json"
                        },
                        credentials:
                            "same-origin",
                        cache:
                            "no-store"
                    }
                )
                    .then(
                        async response => {
                            if (!response.ok) {
                                throw new Error(
                                    `Map configuration HTTP ${response.status}`
                                );
                            }

                            return await response.json();
                        }
                    )
                    .catch(error => {
                        configPromise = null;
                        throw error;
                    });
        }

        return configPromise;
    }

    function createProxyLayer(
        definition,
        options
    ) {
        const maxZoom =
            Math.min(
                Number(
                    definition.maxZoom ||
                    options.maxZoom ||
                    19
                ),
                Number(
                    options.maxZoom ||
                    19
                )
            );

        const template =
            options.proxyTemplate;

        const url =
            template
                .replace(
                    "{layer}",
                    encodeURIComponent(
                        definition.id
                    )
                );

        return L.tileLayer(
            url,
            {
                maxZoom,
                maxNativeZoom:
                    maxZoom,

                tileSize:
                    256,

                updateWhenIdle:
                    true,

                updateWhenZooming:
                    false,

                keepBuffer:
                    2,

                attribution:
                    definition.attribution ||
                    "ProMap Cargo"
            }
        );
    }

    function createExternalLayer(
        definition
    ) {
        return L.tileLayer(
            definition.url,
            {
                maxZoom:
                    definition.maxZoom ||
                    19,

                maxNativeZoom:
                    definition.maxZoom ||
                    19,

                tileSize:
                    256,

                updateWhenIdle:
                    true,

                updateWhenZooming:
                    false,

                keepBuffer:
                    2,

                attribution:
                    definition.attribution ||
                    ""
            }
        );
    }

    function createLayer(
        definition,
        options
    ) {
        if (
            definition.url &&
            definition.id === "osm"
        ) {
            return createExternalLayer(
                definition
            );
        }

        return createProxyLayer(
            definition,
            options
        );
    }

    function mergeDefinitions(
        config
    ) {
        const backendLayers =
            Array.isArray(
                config?.layers
            )
                ? config.layers
                : [];

        const backend =
            new Map();

        for (
            const item
            of backendLayers
        ) {
            if (!item?.id) {
                continue;
            }

            backend.set(
                String(
                    item.id
                ).toLowerCase(),
                item
            );
        }

        const result = [];

        result.push({
            ...OSM_LIGHT
        });

        for (
            const id
            of [
                "dark",
                "satellite",
                "flow",
                "incidents"
            ]
        ) {
            result.push({
                ...CANONICAL[id],
                ...(backend.get(id) || {}),
                id
            });
        }

        return result;
    }

    function removeOldTileLayers(
        map
    ) {
        const remove = [];

        map.eachLayer(
            layer => {
                if (
                    !layer ||
                    !layer._url
                ) {
                    return;
                }

                if (
                    layer.__proMapLayer
                ) {
                    return;
                }

                const url =
                    String(
                        layer._url
                    ).toLowerCase();

                if (
                    url.includes(
                        "tile.openstreetmap.org"
                    ) ||
                    url.includes(
                        "basemaps.cartocdn.com"
                    ) ||
                    url === "/api/map" ||
                    url.startsWith(
                        "/api/map?"
                    )
                ) {
                    remove.push(
                        layer
                    );
                }
            }
        );

        remove.forEach(
            layer =>
                map.removeLayer(
                    layer
                )
        );
    }

    function removeOldLayerControls(
        map
    ) {
        const container =
            getMapContainer(map);

        if (!container) {
            return;
        }

        container
            .querySelectorAll(
                ".leaflet-control-layers"
            )
            .forEach(
                control =>
                    control.remove()
            );
    }

    function buildBaseLayers(
        definitions,
        options
    ) {
        const base = {};

        for (
            const definition
            of definitions
        ) {
            if (
                definition.type !==
                "base"
            ) {
                continue;
            }

            if (
                definition.enabled ===
                false
            ) {
                continue;
            }

            const layer =
                createLayer(
                    definition,
                    options
                );

            layer.__proMapLayer =
                true;

            layer.__proMapLayerId =
                definition.id;

            base[
                definition.label
            ] = layer;
        }

        if (
            !base["OSM Light"]
        ) {
            const layer =
                createExternalLayer(
                    OSM_LIGHT
                );

            layer.__proMapLayer =
                true;

            layer.__proMapLayerId =
                "osm";

            base["OSM Light"] =
                layer;
        }

        if (
            !base["Satellite"]
        ) {
            const definition =
                CANONICAL.satellite;

            const layer =
                createProxyLayer(
                    definition,
                    options
                );

            layer.__proMapLayer =
                true;

            layer.__proMapLayerId =
                "satellite";

            base["Satellite"] =
                layer;
        }

        return base;
    }

    function buildOverlays(
        definitions,
        options
    ) {
        const overlays = {};

        for (
            const definition
            of definitions
        ) {
            if (
                definition.type !==
                "overlay"
            ) {
                continue;
            }

            if (
                definition.enabled ===
                false
            ) {
                continue;
            }

            const layer =
                createProxyLayer(
                    definition,
                    options
                );

            layer.__proMapLayer =
                true;

            layer.__proMapLayerId =
                definition.id;

            overlays[
                definition.label
            ] = layer;
        }

        return overlays;
    }

    function selectDefault(
        base,
        options
    ) {
        const wanted =
            String(
                options.defaultBase ||
                "dark"
            ).toLowerCase();

        if (
            (
                wanted === "dark" ||
                wanted === "tomtom-dark"
            ) &&
            base["TomTom Dark"]
        ) {
            return base[
                "TomTom Dark"
            ];
        }

        if (
            wanted ===
            "satellite" &&
            base["Satellite"]
        ) {
            return base[
                "Satellite"
            ];
        }

        if (
            wanted === "osm" &&
            base["OSM Light"]
        ) {
            return base[
                "OSM Light"
            ];
        }

        if (
            base["TomTom Dark"]
        ) {
            return base[
                "TomTom Dark"
            ];
        }

        if (
            base["OSM Light"]
        ) {
            return base[
                "OSM Light"
            ];
        }

        return Object.values(
            base
        )[0] || null;
    }

    async function attach(
        map,
        overrides = {}
    ) {
        if (
            !map ||
            !window.L
        ) {
            return null;
        }

        if (
            map.__proMapLayersPromise
        ) {
            return map.__proMapLayersPromise;
        }

        const options = {
            ...getOptions(map),
            ...overrides
        };

        map.__proMapLayersPromise =
            (async () => {
                let config;

                try {
                    config =
                        await loadConfig(
                            options.configUrl
                        );
                }
                catch (error) {
                    console.warn(
                        "ProMap map configuration unavailable.",
                        error
                    );

                    config = {
                        layers: []
                    };
                }

                const definitions =
                    mergeDefinitions(
                        config
                    );

                removeOldTileLayers(
                    map
                );

                removeOldLayerControls(
                    map
                );

                const base =
                    buildBaseLayers(
                        definitions,
                        options
                    );

                const overlays =
                    buildOverlays(
                        definitions,
                        options
                    );

                const selected =
                    selectDefault(
                        base,
                        options
                    );

                if (selected) {
                    selected.addTo(
                        map
                    );
                }

                const control =
                    L.control.layers(
                        base,
                        overlays,
                        {
                            collapsed:
                                true,

                            position:
                                "topright"
                        }
                    );

                control.addTo(
                    map
                );

                map.__proMapLayers = {
                    map,
                    base,
                    overlays,
                    control,
                    definitions,
                    config,
                    options
                };

                console.info(
                    "ProMap layers ready",
                    {
                        base:
                            Object.keys(
                                base
                            ),

                        overlays:
                            Object.keys(
                                overlays
                            ),

                        defaultBase:
                            selected
                                ? selected
                                    .__proMapLayerId
                                : null
                    }
                );

                return map.__proMapLayers;
            })();

        return map.__proMapLayersPromise;
    }

    function installMapHook() {
        if (
            mapHookInstalled ||
            !window.L ||
            typeof L.map !==
            "function"
        ) {
            return;
        }

        mapHookInstalled =
            true;

        const originalMap =
            L.map;

        L.map = function (...args) {
            const map =
                originalMap.apply(
                    this,
                    args
                );

            Promise.resolve()
                .then(
                    () =>
                        attach(map)
                )
                .catch(
                    error =>
                        console.error(
                            "ProMap map layer initialization failed.",
                            error
                        )
                );

            return map;
        };
    }

    function initialize() {
        if (!window.L) {
            console.error(
                "ProMap map layers: Leaflet nije učitan."
            );

            return;
        }

        installMapHook();
    }

    window.ProMap.MapLayers = {
        attach,
        loadConfig
    };

    initialize();
})();