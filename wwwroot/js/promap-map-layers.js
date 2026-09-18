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

    const KNOWN_MAP_IDS = [
        "dispatchMap",
        "navMap",
        "monitoringMap",
        "dashboardMap"
    ];

    const LEGACY_OSM_PATTERNS = [
        "tile.openstreetmap.org",
        "openstreetmap.org"
    ];

    const LEGACY_DARK_PATTERNS = [
        "basemaps.cartocdn.com",
        "cartocdn.com"
    ];

    let configPromise = null;

    const definitions =
        new Map();

    function rootElement(root) {
        return (
            root ||
            document.querySelector(
                "[data-map-layers]"
            ) ||
            document.body
        );
    }

    function optionsFrom(root) {
        const element =
            rootElement(root);

        return {
            proxyTemplate:
                element.dataset.mapProxy ||
                DEFAULTS.proxyTemplate,

            configUrl:
                element.dataset.mapConfig ||
                DEFAULTS.configUrl,

            defaultBase:
                (
                    element.dataset.mapDefaultBase ||
                    DEFAULTS.defaultBase
                ).toLowerCase(),

            maxZoom:
                Number(
                    element.dataset.mapMaxZoom ||
                    DEFAULTS.maxZoom
                )
        };
    }

    function configureKnownMapElement(
        element
    ) {
        if (!element) {
            return;
        }

        if (
            !element.dataset.mapLayers
        ) {
            element.dataset.mapLayers =
                "";
        }

        if (
            !element.dataset.mapProxy
        ) {
            element.dataset.mapProxy =
                DEFAULTS.proxyTemplate;
        }

        if (
            !element.dataset.mapConfig
        ) {
            element.dataset.mapConfig =
                DEFAULTS.configUrl;
        }

        if (
            !element.dataset.mapDefaultBase
        ) {
            element.dataset.mapDefaultBase =
                DEFAULTS.defaultBase;
        }

        if (
            !element.dataset.mapMaxZoom
        ) {
            element.dataset.mapMaxZoom =
                String(
                    DEFAULTS.maxZoom
                );
        }
    }

    function getMapRoot(
        map
    ) {
        if (
            !map ||
            typeof map.getContainer !==
            "function"
        ) {
            return null;
        }

        const element =
            map.getContainer();

        if (!element) {
            return null;
        }

        configureKnownMapElement(
            element
        );

        return element;
    }

    async function loadConfig(
        url
    ) {
        if (!configPromise) {
            configPromise =
                fetch(
                    url ||
                    DEFAULTS.configUrl,
                    {
                        method:
                            "GET",

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
                            if (
                                !response.ok
                            ) {
                                throw new Error(
                                    `Map configuration HTTP ${response.status}`
                                );
                            }

                            return await response.json();
                        }
                    )
                    .catch(
                        error => {
                            configPromise =
                                null;

                            throw error;
                        }
                    );
        }

        return configPromise;
    }

    function proxyTemplateUrl(
        template,
        layer,
        coords
    ) {
        return template
            .replace(
                "{layer}",
                encodeURIComponent(
                    layer
                )
            )
            .replace(
                "{z}",
                String(
                    coords.z
                )
            )
            .replace(
                "{x}",
                String(
                    coords.x
                )
            )
            .replace(
                "{y}",
                String(
                    coords.y
                )
            );
    }

    function proxyTileUrl(
        definition,
        options,
        coords
    ) {
        return proxyTemplateUrl(
            options.proxyTemplate,
            definition.id,
            coords
        );
    }

    function createProxyTileLayer(
        definition,
        options
    ) {
        const maxZoom =
            Math.min(
                Number(
                    definition.maxZoom ||
                    options.maxZoom
                ),
                options.maxZoom
            );

        const layer =
            L.tileLayer(
                "about:blank",
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
                        1,

                    attribution:
                        definition.attribution ||
                        ""
                }
            );

        layer.getTileUrl =
            coords =>
                proxyTileUrl(
                    definition,
                    options,
                    coords
                );

        layer.options.attribution =
            definition.attribution ||
            "";

        layer.__proMapLayerId =
            String(
                definition.id
            ).toLowerCase();

        layer.__proMapProxy =
            true;

        return layer;
    }

    function isLegacyExternalLayer(
        layer
    ) {
        if (
            !layer ||
            !layer._url
        ) {
            return null;
        }

        const url =
            String(
                layer._url
            ).toLowerCase();

        if (
            LEGACY_OSM_PATTERNS.some(
                pattern =>
                    url.includes(
                        pattern
                    )
            )
        ) {
            return "satellite";
        }

        if (
            LEGACY_DARK_PATTERNS.some(
                pattern =>
                    url.includes(
                        pattern
                    )
            )
        ) {
            return "dark";
        }

        return null;
    }

    function rewireLegacyLayer(
        layer,
        providerLayer,
        options
    ) {
        if (
            !layer ||
            !providerLayer
        ) {
            return false;
        }

        const originalRole =
            isLegacyExternalLayer(
                layer
            );

        if (!originalRole) {
            return false;
        }

        const definition = {
            id:
                providerLayer,

            label:
                providerLayer ===
                    "dark"
                    ? "TomTom Dark"
                    : "Satellite",

            maxZoom:
                providerLayer ===
                    "dark"
                    ? 19
                    : 19,

            attribution:
                providerLayer ===
                    "dark"
                    ? "© TomTom"
                    : "Tiles © Esri"
        };

        layer.__proMapLayerId =
            providerLayer;

        layer.__proMapLegacy =
            true;

        layer.__proMapOriginalUrl =
            layer._url;

        layer.options.maxZoom =
            definition.maxZoom;

        layer.options.maxNativeZoom =
            definition.maxZoom;

        layer.options.attribution =
            definition.attribution;

        layer.getTileUrl =
            coords =>
                proxyTileUrl(
                    definition,
                    options,
                    coords
                );

        layer._url =
            options.proxyTemplate;

        return true;
    }

    function findLegacyLayers(
        map
    ) {
        const result = {
            dark:
                null,

            satellite:
                null
        };

        map.eachLayer(
            layer => {
                const role =
                    isLegacyExternalLayer(
                        layer
                    );

                if (
                    role ===
                    "dark" &&
                    !result.dark
                ) {
                    result.dark =
                        layer;
                }

                if (
                    role ===
                    "satellite" &&
                    !result.satellite
                ) {
                    result.satellite =
                        layer;
                }
            }
        );

        return result;
    }

    function removeLegacyLayerControls(
        map
    ) {
        const container =
            map.getContainer();

        if (!container) {
            return;
        }

        container
            .querySelectorAll(
                ".leaflet-control-layers"
            )
            .forEach(
                element =>
                    element.remove()
            );
    }

    function createBaseLayer(
        id,
        config,
        options
    ) {
        const definition =
            config.find(
                item =>
                    String(
                        item.id
                    ).toLowerCase() ===
                    id
            );

        if (!definition) {
            return null;
        }

        if (
            definition.enabled ===
            false
        ) {
            return null;
        }

        return createProxyTileLayer(
            definition,
            options
        );
    }

    function createOverlay(
        map,
        definition,
        options
    ) {
        let tile =
            null;

        const group =
            L.layerGroup();

        group.__proMapLayerId =
            String(
                definition.id
            ).toLowerCase();

        group.on(
            "add",
            () => {
                if (!tile) {
                    tile =
                        createProxyTileLayer(
                            definition,
                            options
                        );
                }

                if (
                    !map.hasLayer(
                        tile
                    )
                ) {
                    tile.addTo(
                        map
                    );
                }
            }
        );

        group.on(
            "remove",
            () => {
                if (
                    tile &&
                    map.hasLayer(
                        tile
                    )
                ) {
                    map.removeLayer(
                        tile
                    );
                }
            }
        );

        return group;
    }

    function selectBaseLayer(
        map,
        layer
    ) {
        if (!layer) {
            return;
        }

        map.eachLayer(
            current => {
                if (
                    current.__proMapBaseLayer &&
                    current !== layer &&
                    map.hasLayer(
                        current
                    )
                ) {
                    map.removeLayer(
                        current
                    );
                }
            }
        );

        layer.__proMapBaseLayer =
            true;

        if (
            !map.hasLayer(
                layer
            )
        ) {
            layer.addTo(
                map
            );
        }
    }

    async function attach(
        map,
        userOptions = {}
    ) {
        if (
            !map ||
            !window.L
        ) {
            return null;
        }

        if (
            map.__proMapLayersAttached
        ) {
            return map.__proMapLayers;
        }

        map.__proMapLayersAttached =
            true;

        const root =
            rootElement(
                userOptions.root ||
                getMapRoot(
                    map
                )
            );

        configureKnownMapElement(
            root
        );

        const options = {
            ...optionsFrom(
                root
            ),

            ...userOptions
        };

        let config;

        try {
            const payload =
                await loadConfig(
                    options.configUrl
                );

            config =
                Array.isArray(
                    payload?.layers
                )
                    ? payload.layers
                    : [];
        } catch (
        error
        ) {
            console.warn(
                "ProMap map configuration unavailable.",
                error
            );

            config = [];
        }

        definitions.clear();

        for (
            const definition of
            config
        ) {
            if (
                definition?.id
            ) {
                definitions.set(
                    String(
                        definition.id
                    ).toLowerCase(),
                    definition
                );
            }
        }

        const enabledDefinitions =
            config.filter(
                definition =>
                    definition &&
                    definition.enabled !==
                    false
            );

        const legacy =
            findLegacyLayers(
                map
            );

        if (
            legacy.dark
        ) {
            rewireLegacyLayer(
                legacy.dark,
                "dark",
                options
            );
        }

        if (
            legacy.satellite
        ) {
            rewireLegacyLayer(
                legacy.satellite,
                "satellite",
                options
            );
        }

        let darkLayer =
            legacy.dark;

        let satelliteLayer =
            legacy.satellite;

        if (
            !darkLayer
        ) {
            darkLayer =
                createBaseLayer(
                    "dark",
                    enabledDefinitions,
                    options
                );
        }

        if (
            !satelliteLayer
        ) {
            satelliteLayer =
                createBaseLayer(
                    "satellite",
                    enabledDefinitions,
                    options
                );
        }

        const base = {};

        if (
            darkLayer
        ) {
            base[
                "TomTom Dark"
            ] =
                darkLayer;
        }

        if (
            satelliteLayer
        ) {
            base[
                "Satellite"
            ] =
                satelliteLayer;
        }

        const overlays = {};

        for (
            const definition of
            enabledDefinitions
        ) {
            if (
                definition.type !==
                "overlay"
            ) {
                continue;
            }

            const label =
                definition.label ||
                definition.id;

            overlays[
                label
            ] =
                createOverlay(
                    map,
                    definition,
                    options
                );
        }

        removeLegacyLayerControls(
            map
        );

        let selected =
            null;

        const wanted =
            String(
                options.defaultBase ||
                "dark"
            ).toLowerCase();

        if (
            wanted ===
            "satellite" &&
            satelliteLayer
        ) {
            selected =
                satelliteLayer;
        } else if (
            darkLayer
        ) {
            selected =
                darkLayer;
        } else {
            selected =
                satelliteLayer;
        }

        if (
            selected
        ) {
            selectBaseLayer(
                map,
                selected
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
            ).addTo(
                map
            );

        const result = {
            base,
            overlays,
            created: {
                dark:
                    darkLayer,

                satellite:
                    satelliteLayer
            },
            config,
            control
        };

        map.__proMapLayers =
            result;

        return result;
    }

    function getLayer(
        collection,
        id
    ) {
        if (
            !collection
        ) {
            return null;
        }

        const wanted =
            String(
                id
            ).toLowerCase();

        for (
            const [
                label,
                layer
            ] of Object.entries(
                collection
            )
        ) {
            if (
                String(
                    label
                ).toLowerCase() ===
                wanted
            ) {
                return layer;
            }
        }

        return null;
    }

    function attachExistingMaps() {
        if (
            !window.L
        ) {
            return;
        }

        for (
            const id of
            KNOWN_MAP_IDS
        ) {
            const element =
                document.getElementById(
                    id
                );

            if (
                element
            ) {
                configureKnownMapElement(
                    element
                );
            }
        }
    }

    function installMapHook() {
        if (
            !window.L ||
            L.__proMapMapHookInstalled
        ) {
            return;
        }

        L.__proMapMapHookInstalled =
            true;

        const originalMap =
            L.map;

        L.map =
            function (...args) {
                const map =
                    originalMap.apply(
                        this,
                        args
                    );

                window.setTimeout(
                    () => {
                        attach(
                            map,
                            {
                                root:
                                    map.getContainer()
                            }
                        ).catch(
                            error =>
                                console.warn(
                                    "ProMap map layer integration failed.",
                                    error
                                )
                        );
                    },
                    0
                );

                return map;
            };
    }

    function initialize() {
        attachExistingMaps();
        installMapHook();
    }

    window.ProMap.MapLayers = {
        attach,
        loadConfig,
        getLayer,
        initialize
    };

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once:
                    true
            }
        );
    } else {
        initialize();
    }
})();