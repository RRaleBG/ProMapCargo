(() => {
    "use strict";

    if (window.__promapNavigationInitialized) {
        return;
    }

    window.__promapNavigationInitialized = true;

    const $ = (id) => document.getElementById(id);

    const state = {
        map: null,

        start: null,
        end: null,

        startMarker: null,
        endMarker: null,
        positionMarker: null,

        routeLayers: [],

        routeResponse: null,
        selectedRouteIndex: 0,

        routeCoordinates: [],
        maneuvers: [],

        profile: "truck",

        mapPickTarget: null,

        watchId: null,
        lastRerouteAt: 0,

        routing: false,
    };

    const DEFAULTS = {
        start: {
            latitude: 44.8178,
            longitude: 20.4573,
            label: "Beograd, Srbija",
        },

        end: {
            latitude: 45.2551,
            longitude: 19.8335,
            label: "Novi Sad, Srbija",
        },
    };

    function num(id, fallback = 0) {
        const element = $(id);

        if (!element) {
            return fallback;
        }

        const value = Number.parseFloat(element.value);

        return Number.isFinite(value) ? value : fallback;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function setText(id, value) {
        const element = $(id);

        if (element) {
            element.textContent = value ?? "";
        }
    }

    function showError(message) {
        const element = $("navError");

        if (!element) {
            return;
        }

        element.textContent = message || "";
        element.style.display = message ? "block" : "none";
    }

    function setNavigationStatus(text, type = "ready") {
        const element = $("navStatus");

        if (!element) {
            return;
        }

        element.textContent = text;
        element.className = "nav-chip";

        if (type === "ready") {
            element.classList.add("ready");
        } else if (type === "warning") {
            element.classList.add("warning");
        } else if (type === "danger") {
            element.classList.add("danger");
        }
    }

    function setGpsStatus(text, type = "") {
        const element = $("gpsStatus");

        if (!element) {
            return;
        }

        element.textContent = text;
        element.className = "nav-chip";

        if (type === "ready") {
            element.classList.add("ready");
        }

        if (type === "warning") {
            element.classList.add("warning");
        }

        if (type === "danger") {
            element.classList.add("danger");
        }
    }

    function setEngine(engine, fallback = false) {
        const value = fallback
            ? `${engine || "OSRM"} · FALLBACK`
            : engine || "PostGIS";

        setText("engineBadge", `Routing: ${value}`);
        setText("summaryEngine", value);

        const footer = $("engineFooter");

        if (footer) {
            footer.textContent = value;
        }
    }

    function formatDistance(meters) {
        const value = Number(meters);

        if (!Number.isFinite(value)) {
            return "—";
        }

        if (value >= 1000) {
            return `${(value / 1000).toFixed(1)} km`;
        }

        return `${Math.round(value)} m`;
    }

    function formatDuration(seconds) {
        const value = Number(seconds);

        if (!Number.isFinite(value)) {
            return "—";
        }

        const totalMinutes = Math.max(0, Math.round(value / 60));

        if (totalMinutes < 60) {
            return `${totalMinutes} min`;
        }

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        return `${hours} h ${minutes} min`;
    }

    function formatEta(value) {
        if (!value) {
            return "—";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "—";
        }

        return date.toLocaleString("sr-RS", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function coordinateDistanceMeters(a, b) {
        if (!a || !b) {
            return Infinity;
        }

        if (
            !Number.isFinite(Number(a.lat)) ||
            !Number.isFinite(Number(a.lon)) ||
            !Number.isFinite(Number(b.lat)) ||
            !Number.isFinite(Number(b.lon))
        ) {
            return Infinity;
        }

        const R = 6371000;

        const lat1 = (a.lat * Math.PI) / 180;
        const lat2 = (b.lat * Math.PI) / 180;

        const dLat = ((b.lat - a.lat) * Math.PI) / 180;
        const dLon = ((b.lon - a.lon) * Math.PI) / 180;

        const sinLat = Math.sin(dLat / 2);
        const sinLon = Math.sin(dLon / 2);

        const h =
            sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

        return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function normalizePoint(point) {
        if (!point) {
            return null;
        }

        const latitude = Number(
            point.latitude ?? point.lat ?? point.Lat ?? point.coords?.latitude,
        );

        const longitude = Number(
            point.longitude ?? point.lon ?? point.Lon ?? point.coords?.longitude,
        );

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
        ) {
            return null;
        }

        return {
            lat: latitude,
            lon: longitude,

            label:
                point.displayName ??
                point.display_name ??
                point.displayName ??
                point.label ??
                "",
        };
    }

    function normalizeGpsPosition(position) {
        if (!position) {
            return null;
        }

        const source =
            position.coords && typeof position.coords === "object"
                ? position.coords
                : position;

        const latitude = Number(
            source.latitude ??
            source.lat ??
            source.Lat ??
            position.latitude ??
            position.lat ??
            position.Lat,
        );

        const longitude = Number(
            source.longitude ??
            source.lon ??
            source.Lon ??
            position.longitude ??
            position.lon ??
            position.Lon,
        );

        const accuracy = Number(source.accuracy ?? position.accuracy);

        const speed = Number(source.speed ?? position.speed);

        const heading = Number(source.heading ?? position.heading);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
        ) {
            console.error(
                "ProMap Cargo: GPS position nema validne koordinate.",
                position,
            );

            return null;
        }

        return {
            latitude,
            longitude,

            accuracy: Number.isFinite(accuracy) ? accuracy : null,

            speed: Number.isFinite(speed) ? speed : null,

            heading: Number.isFinite(heading) ? heading : null,

            timestamp: position.timestamp ?? source.timestamp ?? Date.now(),
        };
    }

    function parseCoordinates(value) {
        if (!value) {
            return null;
        }

        const text = String(value).trim();

        const match = text.match(
            /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/,
        );

        if (!match) {
            return null;
        }

        const latitude = Number(match[1].replace(",", "."));
        const longitude = Number(match[2].replace(",", "."));

        return normalizePoint({
            latitude,
            longitude,
        });
    }

    function geometryToCoordinates(geometry) {
        if (!geometry) {
            return [];
        }

        let value = geometry;

        if (typeof value === "string") {
            try {
                value = JSON.parse(value);
            } catch {
                return [];
            }
        }

        if (value.type === "Feature") {
            value = value.geometry;
        }

        if (!value || !value.type) {
            return [];
        }

        if (value.type === "LineString") {
            return (value.coordinates || [])
                .filter(
                    (point) =>
                        Array.isArray(point) &&
                        point.length >= 2 &&
                        Number.isFinite(Number(point[0])) &&
                        Number.isFinite(Number(point[1])),
                )
                .map((point) => [Number(point[1]), Number(point[0])]);
        }

        if (value.type === "MultiLineString") {
            const result = [];

            for (const line of value.coordinates || []) {
                for (const point of line || []) {
                    if (
                        Array.isArray(point) &&
                        point.length >= 2 &&
                        Number.isFinite(Number(point[0])) &&
                        Number.isFinite(Number(point[1]))
                    ) {
                        result.push([Number(point[1]), Number(point[0])]);
                    }
                }
            }

            return result;
        }

        return [];
    }

    function initializeMap() {
        const mapElement = $("navMap");

        if (!mapElement) {
            return;
        }

        if (!window.L) {
            showError("Leaflet nije učitan. Proveri Leaflet CDN u _Layout.cshtml.");

            return;
        }

        if (state.map) {
            return;
        }

        state.map = L.map("navMap", {
            zoomControl: true,
            preferCanvas: true,
        }).setView([44.9, 20.5], 8);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OpenStreetMap contributors",
        }).addTo(state.map);

        state.map.on("click", (event) => {
            if (!state.mapPickTarget) {
                return;
            }

            if (
                !event ||
                !event.latlng ||
                !Number.isFinite(event.latlng.lat) ||
                !Number.isFinite(event.latlng.lng)
            ) {
                return;
            }

            const point = {
                lat: event.latlng.lat,
                lon: event.latlng.lng,
            };

            if (state.mapPickTarget === "start") {
                state.start = point;

                const input = $("navStart");

                if (input) {
                    input.value = `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
                }

                setText(
                    "navStartResolved",
                    `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`,
                );

                updateStartMarker();
            }

            if (state.mapPickTarget === "end") {
                state.end = point;

                const input = $("navEnd");

                if (input) {
                    input.value = `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
                }

                setText(
                    "navEndResolved",
                    `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`,
                );

                updateEndMarker();
            }

            state.mapPickTarget = null;
        });
    }

    function updateStartMarker() {
        if (!state.map || !state.start) {
            return;
        }

        const point = normalizePoint(state.start);

        if (!point) {
            console.warn(
                "ProMap Cargo: start marker skipped because coordinates are invalid.",
                state.start,
            );

            return;
        }

        state.start = point;

        if (state.startMarker) {
            state.startMarker.remove();
        }

        state.startMarker = L.marker([point.lat, point.lon])
            .addTo(state.map)
            .bindPopup(
                `<strong>START</strong><br>${escapeHtml(
                    point.label || `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`,
                )}`,
            );
    }

    function updateEndMarker() {
        if (!state.map || !state.end) {
            return;
        }

        const point = normalizePoint(state.end);

        if (!point) {
            console.warn(
                "ProMap Cargo: destination marker skipped because coordinates are invalid.",
                state.end,
            );

            return;
        }

        state.end = point;

        if (state.endMarker) {
            state.endMarker.remove();
        }

        state.endMarker = L.marker([point.lat, point.lon])
            .addTo(state.map)
            .bindPopup(
                `<strong>DESTINACIJA</strong><br>${escapeHtml(
                    point.label || `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`,
                )}`,
            );
    }

    function updateMarkers() {
        updateStartMarker();
        updateEndMarker();
    }

    function clearRouteLayers() {
        for (const layer of state.routeLayers) {
            try {
                layer.remove();
            } catch { }
        }

        state.routeLayers = [];
        state.routeCoordinates = [];
        state.maneuvers = [];
    }

    function clearRoute() {
        clearRouteLayers();

        state.routeResponse = null;
        state.selectedRouteIndex = 0;

        setText("summaryDistance", "—");
        setText("summaryDuration", "—");
        setText("summaryEta", "—");
        setText("summarySafety", "—");
        setText("summaryEngine", "—");
        setText("summaryDiagnostics", "—");

        setText("nextInstructionText", "Izračunajte rutu.");

        setText("nextInstructionDistance", "—");

        setText("routeSafeBadge", "Truck: —");

        setNavigationStatus("READY", "ready");

        const alternatives = $("alternativesCard");
        const warnings = $("warningsCard");
        const maneuvers = $("maneuversCard");

        if (alternatives) {
            alternatives.style.display = "none";
        }

        if (warnings) {
            warnings.style.display = "none";
        }

        if (maneuvers) {
            maneuvers.style.display = "none";
        }

        const liveButton = $("startLiveNavigation");

        if (liveButton) {
            liveButton.disabled = true;
        }

        showError("");
    }

    function buildRequest(start, end) {
        const request = {
            start: {
                latitude: start.lat,
                longitude: start.lon,
            },

            destination: {
                latitude: end.lat,
                longitude: end.lon,
            },

            profile: state.profile,

            avoidRestricted: $("navAvoid")?.checked ?? true,

            departureAt: new Date().toISOString(),
        };

        if (state.profile === "truck") {
            request.truck = {
                grossWeightT: num("navWeight", 40),

                heightM: num("navHeight", 4),

                widthM: num("navWidth", 2.55),

                lengthM: num("navLength", 16.5),

                axleLoadT: num("navAxleLoad", 10),

                axles: Math.round(num("navAxles", 5)),

                maxSpeedKmh: num("navMaxSpeed", 90),

                commercial: true,

                isHgv: true,

                hazmat: $("navHazmat")?.checked ?? false,

                adrClass: $("navAdrClass")?.value?.trim() || null,

                vehicleClass: "HeavyGoods",
            };
        }

        return request;
    }

    function validateRequest(request) {
        const start = request.start;
        const destination = request.destination;

        if (
            !start ||
            !destination ||
            !Number.isFinite(start.latitude) ||
            !Number.isFinite(start.longitude) ||
            !Number.isFinite(destination.latitude) ||
            !Number.isFinite(destination.longitude)
        ) {
            return "Start i destination moraju sadržati validne geografske koordinate.";
        }

        if (
            start.latitude < -90 ||
            start.latitude > 90 ||
            start.longitude < -180 ||
            start.longitude > 180 ||
            destination.latitude < -90 ||
            destination.latitude > 90 ||
            destination.longitude < -180 ||
            destination.longitude > 180
        ) {
            return "Koordinate nisu u validnom geografskom opsegu.";
        }

        if (state.profile === "truck") {
            const fields = [
                ["navWeight", "Masa"],
                ["navHeight", "Visina"],
                ["navWidth", "Širina"],
                ["navLength", "Dužina"],
                ["navMaxSpeed", "Max brzina"],
            ];

            for (const [id, label] of fields) {
                const value = num(id, NaN);

                if (!Number.isFinite(value) || value <= 0) {
                    return `${label} mora biti veća od nule.`;
                }
            }
        }

        return null;
    }

    async function geocode(query) {
        const coordinates = parseCoordinates(query);

        if (coordinates) {
            return {
                ...coordinates,
                label: query,
            };
        }

        const response = await fetch(
            `/api/geocode?q=${encodeURIComponent(query)}&limit=5`,
            {
                method: "GET",

                headers: {
                    Accept: "application/json",
                },
            },
        );

        if (!response.ok) {
            throw new Error(`Geocoding API HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            return null;
        }

        const first = data[0];

        return normalizePoint({
            latitude: first.latitude ?? first.lat,

            longitude: first.longitude ?? first.lon,

            displayName:
                first.displayName ?? first.display_name ?? first.Display_Name,
        });
    }

    function renderSuggestions(containerId, data, inputId, resolvedId) {
        const container = $(containerId);

        if (!container) {
            return;
        }

        if (!Array.isArray(data) || data.length === 0) {
            container.innerHTML = "";
            container.style.display = "none";

            return;
        }

        container.innerHTML = data
            .map(
                (item, index) => `
                    <div
                        class="nav-suggestion"
                        data-index="${index}">
                        ${escapeHtml(
                    item.displayName ??
                    item.display_name ??
                    item.Display_Name ??
                    `${item.lat}, ${item.lon}`,
                )}
                    </div>
                `,
            )
            .join("");

        container.style.display = "block";

        container.querySelectorAll(".nav-suggestion").forEach((element) => {
            element.addEventListener("click", () => {
                const index = Number(element.dataset.index);

                const selected = data[index];

                const point = normalizePoint({
                    latitude: selected.latitude ?? selected.lat,

                    longitude: selected.longitude ?? selected.lon,

                    displayName:
                        selected.displayName ??
                        selected.display_name ??
                        selected.Display_Name,
                });

                if (!point) {
                    return;
                }

                const input = $(inputId);

                if (input) {
                    input.value =
                        point.label || `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
                }

                state[inputId === "navStart" ? "start" : "end"] = point;

                setText(resolvedId, `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`);

                container.style.display = "none";

                updateMarkers();
            });
        });
    }

    async function autocomplete(inputId, suggestionsId, resolvedId) {
        const input = $(inputId);

        if (!input) {
            return;
        }

        const query = input.value.trim();

        const direct = parseCoordinates(query);

        if (direct) {
            const key = inputId === "navStart" ? "start" : "end";

            state[key] = {
                ...direct,
                label: query,
            };

            setText(resolvedId, `${direct.lat.toFixed(6)}, ${direct.lon.toFixed(6)}`);

            updateMarkers();

            return;
        }

        if (query.length < 3) {
            const box = $(suggestionsId);

            if (box) {
                box.innerHTML = "";
                box.style.display = "none";
            }

            return;
        }

        try {
            const response = await fetch(
                `/api/geocode?q=${encodeURIComponent(query)}&limit=5`,
                {
                    headers: {
                        Accept: "application/json",
                    },
                },
            );

            if (!response.ok) {
                return;
            }

            const data = await response.json();

            renderSuggestions(suggestionsId, data, inputId, resolvedId);
        } catch { }
    }

    async function resolveInput(inputId, fallbackPoint) {
        const input = $(inputId);

        if (!input) {
            return null;
        }

        const query = input.value.trim();

        const direct = parseCoordinates(query);

        if (direct) {
            return {
                ...direct,
                label: query,
            };
        }

        if (!query) {
            return normalizePoint(fallbackPoint);
        }

        const result = await geocode(query);

        if (!result) {
            throw new Error(`Lokacija nije pronađena: ${query}`);
        }

        input.value =
            result.label || `${result.lat.toFixed(6)}, ${result.lon.toFixed(6)}`;

        return result;
    }

    async function resolveRoutePoints() {
        const start = await resolveInput("navStart", DEFAULTS.start);

        const end = await resolveInput("navEnd", DEFAULTS.end);

        if (!start || !end) {
            throw new Error("Start i destinacija moraju biti definisani.");
        }

        const normalizedStart = normalizePoint(start);

        const normalizedEnd = normalizePoint(end);

        if (!normalizedStart || !normalizedEnd) {
            throw new Error(
                "Start i destinacija moraju sadržati validne geografske koordinate.",
            );
        }

        state.start = normalizedStart;

        state.end = normalizedEnd;

        setText(
            "navStartResolved",
            `${normalizedStart.lat.toFixed(6)}, ${normalizedStart.lon.toFixed(6)}`,
        );

        setText(
            "navEndResolved",
            `${normalizedEnd.lat.toFixed(6)}, ${normalizedEnd.lon.toFixed(6)}`,
        );

        updateMarkers();

        return {
            start: normalizedStart,
            end: normalizedEnd,
        };
    }

    async function calculateRoute() {
        if (state.routing) {
            return false;
        }

        if (
            !window.ProMap?.Routing ||
            typeof window.ProMap.Routing.calculate !== "function"
        ) {
            showError("Routing modul nije učitan. Proveri promap-routing.js.");

            return false;
        }

        state.routing = true;

        const button = $("calcRoute");

        if (button) {
            button.disabled = true;
            button.textContent = "Računam…";
        }

        showError("");

        setNavigationStatus("ROUTING", "warning");

        try {
            const points = await resolveRoutePoints();

            const request = buildRequest(points.start, points.end);

            const validation = validateRequest(request);

            if (validation) {
                throw new Error(validation);
            }

            console.log("ProMap Cargo route request:", request);

            const data = await window.ProMap.Routing.calculate({
                start: points.start,

                destination: points.end,

                profile: state.profile,

                avoidRestricted: request.avoidRestricted,

                departureAt: request.departureAt,

                truck: request.truck,
            });

            console.log("ProMap Cargo route response:", data);

            if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
                throw new Error("Routing API je vratio odgovor bez rute.");
            }

            state.routeResponse = data;

            state.selectedRouteIndex = Number.isInteger(data.selectedRouteIndex)
                ? data.selectedRouteIndex
                : 0;

            if (
                state.selectedRouteIndex < 0 ||
                state.selectedRouteIndex >= data.routes.length
            ) {
                state.selectedRouteIndex = 0;
            }

            drawRouteResponse(data);

            setNavigationStatus("READY", "ready");

            return true;
        } catch (error) {
            console.error("Navigation routing error:", error);

            setNavigationStatus("ERROR", "danger");

            showError(error?.message || "Greška prilikom izračunavanja rute.");

            return false;
        } finally {
            state.routing = false;

            if (button) {
                button.disabled = false;

                button.textContent =
                    state.profile === "truck"
                        ? "Izračunaj truck rutu"
                        : "Izračunaj auto rutu";
            }
        }
    }

    function getRouteDistance(route) {
        return Number(route?.distance ?? route?.distanceMeters ?? 0);
    }

    function getRouteDuration(route) {
        return Number(route?.duration ?? route?.durationSeconds ?? 0);
    }

    function drawRouteResponse(data) {
        clearRouteLayers();

        const routes = Array.isArray(data.routes) ? data.routes : [];

        if (routes.length === 0) {
            throw new Error("Routing API je vratio prazan skup ruta.");
        }

        const selectedIndex = Number.isInteger(data.selectedRouteIndex)
            ? data.selectedRouteIndex
            : 0;

        state.selectedRouteIndex = Math.max(
            0,
            Math.min(selectedIndex, routes.length - 1),
        );

        routes.forEach((route, index) => {
            const coordinates = geometryToCoordinates(route.geometry);

            if (coordinates.length < 2) {
                console.warn("Route has no drawable geometry:", route);

                return;
            }

            const selected = index === state.selectedRouteIndex;

            const layer = L.polyline(coordinates, {
                weight: selected ? 7 : 4,

                opacity: selected ? 0.95 : 0.42,

                dashArray: selected ? null : "8 8",
            }).addTo(state.map);

            layer.bindPopup(
                `<strong>Ruta ${index + 1}</strong><br>` +
                `${formatDistance(getRouteDistance(route))} · ` +
                `${formatDuration(getRouteDuration(route))}`,
            );

            layer.on("click", () => {
                selectRoute(index);
            });

            state.routeLayers.push(layer);

            if (selected) {
                state.routeCoordinates = coordinates;
            }
        });

        if (state.routeCoordinates.length === 0) {
            const selectedRoute = routes[state.selectedRouteIndex];

            state.routeCoordinates = geometryToCoordinates(selectedRoute?.geometry);
        }

        if (state.routeCoordinates.length < 2) {
            throw new Error(
                "Routing API je pronašao rutu, ali ruta nema validnu geometriju za prikaz na mapi.",
            );
        }

        renderSummary(data);
        renderAlternatives(data);
        renderWarnings(data);
        renderManeuvers(data);

        fitRoute();

        const startButton = $("startLiveNavigation");

        if (startButton) {
            startButton.disabled = false;
        }
    }

    function selectRoute(index) {
        if (
            !state.routeResponse ||
            !Array.isArray(state.routeResponse.routes) ||
            index < 0 ||
            index >= state.routeResponse.routes.length
        ) {
            return;
        }

        state.selectedRouteIndex = index;

        drawRouteResponse({
            ...state.routeResponse,

            selectedRouteIndex: index,
        });
    }

    function renderSummary(data) {
        const route = data.routes?.[state.selectedRouteIndex];

        if (!route) {
            return;
        }

        setText("summaryDistance", formatDistance(getRouteDistance(route)));

        setText("summaryDuration", formatDuration(getRouteDuration(route)));

        const eta =
            data.summary?.estimatedArrival ?? data.summary?.EstimatedArrival;

        setText("summaryEta", formatEta(eta));

        const safe = data.isTruckSafe === true;

        setText(
            "summarySafety",
            state.profile === "truck" ? (safe ? "SAFE" : "RESTRICTION") : "READY",
        );

        const safeBadge = $("routeSafeBadge");

        if (safeBadge) {
            safeBadge.textContent =
                state.profile === "truck"
                    ? safe
                        ? "Truck: SAFE"
                        : "Truck: WARNING"
                    : "Auto: READY";

            safeBadge.className = safe ? "nav-chip ready" : "nav-chip warning";
        }

        const diagnostics = data.diagnostics;

        if (diagnostics) {
            const details = [];

            if (diagnostics.engine) {
                details.push(`engine=${diagnostics.engine}`);
            }

            if (
                diagnostics.graphVersion !== undefined &&
                diagnostics.graphVersion !== null
            ) {
                details.push(`graph=${diagnostics.graphVersion}`);
            }

            if (diagnostics.expandedStates !== undefined) {
                details.push(`expanded=${diagnostics.expandedStates}`);
            }

            if (diagnostics.failureReason) {
                details.push(diagnostics.failureReason);
            }

            setText("summaryDiagnostics", details.join(" · ") || "OK");

            setEngine(diagnostics.engine, diagnostics.usedFallback === true);
        } else {
            setEngine("Routing");
        }
    }

    function renderAlternatives(data) {
        const card = $("alternativesCard");

        const list = $("routeAlternatives");

        const count = $("alternativeCount");

        if (!card || !list || !count) {
            return;
        }

        const routes = Array.isArray(data.routes) ? data.routes : [];

        const alternatives = routes
            .map((route, index) => ({
                route,
                index,
            }))
            .filter((item) => item.index !== state.selectedRouteIndex);

        count.textContent = String(alternatives.length);

        if (alternatives.length === 0) {
            card.style.display = "none";

            list.innerHTML = "";

            return;
        }

        card.style.display = "block";

        list.innerHTML = alternatives
            .map(
                ({ route, index }) => `
                        <div
                            class="nav-list-item"
                            data-route-index="${index}"
                            style="cursor:pointer;">
                            <strong>Ruta ${index + 1}</strong>
                            ${formatDistance(getRouteDistance(route))}
                            · ${formatDuration(getRouteDuration(route))}
                        </div>
                    `,
            )
            .join("");

        list.querySelectorAll("[data-route-index]").forEach((element) => {
            element.addEventListener("click", () => {
                selectRoute(Number(element.dataset.routeIndex));
            });
        });
    }

    function renderWarnings(data) {
        const card = $("warningsCard");

        const list = $("routeWarnings");

        const count = $("warningCount");

        if (!card || !list || !count) {
            return;
        }

        const violations = [];

        if (Array.isArray(data.violations)) {
            violations.push(...data.violations);
        }

        const selected = data.routes?.[state.selectedRouteIndex];

        if (Array.isArray(selected?.analysis?.violations)) {
            violations.push(...selected.analysis.violations);
        }

        const unique = Array.from(
            new Map(
                violations.map((item) => [
                    item.id || `${item.type}-${item.reason}`,
                    item,
                ]),
            ).values(),
        );

        count.textContent = String(unique.length);

        if (unique.length === 0) {
            card.style.display = "none";

            list.innerHTML = "";

            return;
        }

        card.style.display = "block";

        list.innerHTML = unique
            .map(
                (item) => `
                        <div class="nav-list-item">
                            <strong>
                                ${escapeHtml(
                    item.name || item.type || "Restriction",
                )}
                            </strong>
                            ${escapeHtml(item.reason || "Aktivna restrikcija.")}
                        </div>
                    `,
            )
            .join("");
    }

    function extractManeuvers(data) {
        if (Array.isArray(data.maneuvers) && data.maneuvers.length) {
            return data.maneuvers;
        }

        const route = data.routes?.[state.selectedRouteIndex];

        if (Array.isArray(route?.maneuvers) && route.maneuvers.length) {
            return route.maneuvers;
        }

        const steps = [];

        for (const leg of route?.legs || []) {
            for (const step of leg?.steps || []) {
                const maneuver = step.maneuver || {};

                steps.push({
                    type: maneuver.type || "continue",

                    modifier: maneuver.modifier || null,

                    instruction: step.instruction || step.name || null,

                    distanceMeters: Number.isFinite(Number(step.distance))
                        ? Number(step.distance)
                        : null,
                });
            }
        }

        return steps;
    }

    function renderManeuvers(data) {
        const card = $("maneuversCard");

        const list = $("maneuverList");

        const count = $("maneuverCount");

        if (!card || !list || !count) {
            return;
        }

        const maneuvers = extractManeuvers(data);

        state.maneuvers = maneuvers;

        count.textContent = String(maneuvers.length);

        if (maneuvers.length === 0) {
            card.style.display = "none";

            list.innerHTML = "";

            setText("nextInstructionText", "Ruta je izračunata.");

            setText("nextInstructionDistance", "—");

            return;
        }

        card.style.display = "block";

        list.innerHTML = maneuvers
            .map((maneuver) => {
                const normalized = window.ProMap?.Maneuvers?.normalize
                    ? window.ProMap.Maneuvers.normalize(maneuver)
                    : maneuver;

                return `
                            <div class="nav-list-item">
                                <strong>
                                    ${escapeHtml(
                    normalized.instruction ||
                    maneuver.instruction ||
                    maneuver.type ||
                    "Nastavi",
                )}
                                </strong>
                                <span>
                                    ${formatDistance(
                    normalized.distanceMeters ??
                    maneuver.distanceFromPreviousMeters,
                )}
                                </span>
                            </div>
                        `;
            })
            .join("");

        const first = maneuvers[0];

        if (first) {
            const normalized = window.ProMap?.Maneuvers?.normalize
                ? window.ProMap.Maneuvers.normalize(first)
                : first;

            setText("nextInstructionIcon", normalized.icon || "↑");

            setText(
                "nextInstructionText",
                normalized.instruction || first.instruction || first.type || "Nastavi",
            );

            setText(
                "nextInstructionDistance",
                formatDistance(
                    normalized.distanceMeters ?? first.distanceFromPreviousMeters,
                ),
            );
        }
    }

    function fitRoute() {
        if (!state.map) {
            return;
        }

        const points = [];

        const start = normalizePoint(state.start);

        const end = normalizePoint(state.end);

        if (start) {
            points.push([start.lat, start.lon]);
        }

        if (end) {
            points.push([end.lat, end.lon]);
        }

        for (const coordinate of state.routeCoordinates) {
            if (
                Array.isArray(coordinate) &&
                coordinate.length >= 2 &&
                Number.isFinite(Number(coordinate[0])) &&
                Number.isFinite(Number(coordinate[1]))
            ) {
                points.push([Number(coordinate[0]), Number(coordinate[1])]);
            }
        }

        if (points.length < 2) {
            return;
        }

        state.map.fitBounds(L.latLngBounds(points), {
            padding: [35, 35],
        });
    }

    function handleCurrentGpsPosition(rawPosition) {
        const position = normalizeGpsPosition(rawPosition);

        if (!position) {
            setGpsStatus("GPS INVALID", "danger");

            showError("GPS je vratio nevalidne koordinate.");

            return null;
        }

        const point = {
            lat: position.latitude,
            lon: position.longitude,
            label: "Moja trenutna lokacija",
        };

        state.start = point;

        const input = $("navStart");

        if (input) {
            input.value = `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
        }

        setText(
            "navStartResolved",
            `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`,
        );

        updateStartMarker();

        if (state.map) {
            if (Number.isFinite(point.lat) && Number.isFinite(point.lon)) {
                state.map.setView([point.lat, point.lon], 14);
            }
        }

        setGpsStatus("GPS READY", "ready");

        showError("");

        return point;
    }

    function useCurrentLocation() {
        if (window.ProMap?.Gps) {
            const gps = window.ProMap.Gps;

            if (typeof gps.isSupported === "function" && gps.isSupported()) {
                setGpsStatus("GPS REQUEST", "warning");

                gps.start({
                    enableHighAccuracy: true,

                    maximumAge: 5000,

                    timeout: 15000,

                    onPosition: (position) => {
                        handleCurrentGpsPosition(position);
                    },

                    onError: (error) => {
                        console.error("GPS error:", error);

                        setGpsStatus("GPS ERROR", "danger");

                        showError(
                            "Nije moguće dobiti trenutnu GPS lokaciju. Proveri dozvolu za lokaciju u browseru.",
                        );
                    },
                });

                return;
            }
        }

        if (!navigator.geolocation) {
            showError("Browser ne podržava geolokaciju.");

            return;
        }

        setGpsStatus("GPS REQUEST", "warning");

        navigator.geolocation.getCurrentPosition(
            (position) => {
                handleCurrentGpsPosition(position);
            },
            (error) => {
                console.error("Geolocation error:", error);

                setGpsStatus("GPS ERROR", "danger");

                showError(
                    "Nije moguće dobiti trenutnu GPS lokaciju. Proveri dozvolu za lokaciju u browseru.",
                );
            },
            {
                enableHighAccuracy: true,

                timeout: 10000,

                maximumAge: 5000,
            },
        );
    }

    async function startLiveNavigation() {
        if (state.watchId !== null) {
            return;
        }

        if (
            !state.routeResponse ||
            !Array.isArray(state.routeResponse.routes) ||
            state.routeCoordinates.length < 2
        ) {
            setNavigationStatus("ROUTING", "warning");

            const routeReady = await calculateRoute();

            if (!routeReady) {
                return;
            }
        }

        if (window.ProMap?.Gps) {
            const gps = window.ProMap.Gps;

            if (typeof gps.isSupported === "function" && !gps.isSupported()) {
                showError("Browser ne podržava geolokaciju.");

                return;
            }

            gps.start({
                enableHighAccuracy: true,

                maximumAge: 2000,

                timeout: 10000,

                onPosition: (position) => {
                    onLivePosition(position);
                },

                onError: onLivePositionError,
            });

            state.watchId = "ProMap.Gps";
        } else {
            if (!navigator.geolocation) {
                showError("Browser ne podržava geolokaciju.");

                return;
            }

            state.watchId = navigator.geolocation.watchPosition(
                onLivePosition,
                onLivePositionError,
                {
                    enableHighAccuracy: true,

                    maximumAge: 2000,

                    timeout: 10000,
                },
            );
        }

        setGpsStatus("GPS LIVE", "ready");

        const chip = $("liveChip");

        if (chip) {
            chip.textContent = "LIVE";

            chip.className = "nav-chip ready";
        }

        const startButton = $("startLiveNavigation");

        const stopButton = $("stopLiveNavigation");

        if (startButton) {
            startButton.style.display = "none";
        }

        if (stopButton) {
            stopButton.style.display = "block";
        }
    }

    function stopLiveNavigation() {
        if (window.ProMap?.Gps && state.watchId === "ProMap.Gps") {
            window.ProMap.Gps.stop();
        } else if (state.watchId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(state.watchId);
        }

        state.watchId = null;

        setGpsStatus("GPS OFF");

        const chip = $("liveChip");

        if (chip) {
            chip.textContent = "OFF";

            chip.className = "nav-chip";
        }

        const startButton = $("startLiveNavigation");

        const stopButton = $("stopLiveNavigation");

        if (startButton) {
            startButton.style.display = "block";

            startButton.disabled = !(
                state.routeResponse && state.routeCoordinates.length >= 2
            );
        }

        if (stopButton) {
            stopButton.style.display = "none";
        }

        setText("liveSpeed", "—");

        setText("liveAccuracy", "—");

        setText("liveOffRoute", "—");

        setText("livePosition", "—");
    }

    function onLivePosition(position) {
        const normalized = normalizeGpsPosition(position);

        if (!normalized) {
            setGpsStatus("GPS INVALID", "danger");

            return;
        }

        const lat = normalized.latitude;

        const lon = normalized.longitude;

        const accuracy = normalized.accuracy;

        const speed = normalized.speed;

        const point = {
            lat,
            lon,
        };

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            console.error("ProMap Cargo: odbijena nevalidna GPS pozicija.", position);

            return;
        }

        setText(
            "liveSpeed",
            Number.isFinite(speed) && speed >= 0
                ? `${Math.round(speed * 3.6)} km/h`
                : "—",
        );

        setText(
            "liveAccuracy",
            Number.isFinite(accuracy) ? `${Math.round(accuracy)} m` : "—",
        );

        setText("livePosition", `${lat.toFixed(5)}, ${lon.toFixed(5)}`);

        if (state.map) {
            const leafletPoint = [lat, lon];

            if (
                !Number.isFinite(leafletPoint[0]) ||
                !Number.isFinite(leafletPoint[1])
            ) {
                console.error("ProMap Cargo: Leaflet position rejected.", leafletPoint);

                return;
            }

            if (!state.positionMarker) {
                state.positionMarker = L.circleMarker(leafletPoint, {
                    radius: 8,
                    weight: 3,
                })
                    .addTo(state.map)
                    .bindPopup("Trenutna GPS pozicija");
            } else {
                state.positionMarker.setLatLng(leafletPoint);
            }
        }

        const offRoute = distanceToRouteMeters(point);

        setText(
            "liveOffRoute",
            Number.isFinite(offRoute) ? `${Math.round(offRoute)} m` : "—",
        );

        if (Number.isFinite(offRoute) && offRoute > 100) {
            setText("liveOffRoute", `${Math.round(offRoute)} m · OFF ROUTE`);

            const now = Date.now();

            if (now - state.lastRerouteAt > 30000) {
                state.lastRerouteAt = now;

                showError(`Vozilo je približno ${Math.round(offRoute)} m van rute.`);
            }
        } else {
            if (state.routeCoordinates.length > 0) {
                showError("");
            }
        }
    }

    function onLivePositionError(error) {
        console.error("Live GPS error:", error);

        setGpsStatus("GPS ERROR", "danger");
    }

    function distanceToRouteMeters(point) {
        if (
            !point ||
            !Array.isArray(state.routeCoordinates) ||
            state.routeCoordinates.length === 0
        ) {
            return Infinity;
        }

        let minimum = Infinity;

        for (const coordinate of state.routeCoordinates) {
            if (!Array.isArray(coordinate) || coordinate.length < 2) {
                continue;
            }

            const routeLat = Number(coordinate[0]);

            const routeLon = Number(coordinate[1]);

            if (!Number.isFinite(routeLat) || !Number.isFinite(routeLon)) {
                continue;
            }

            const routePoint = {
                lat: routeLat,
                lon: routeLon,
            };

            const distance = coordinateDistanceMeters(point, routePoint);

            if (distance < minimum) {
                minimum = distance;
            }
        }

        return minimum;
    }

    function setProfile(profile) {
        state.profile = profile === "car" ? "car" : "truck";

        const truckButton = $("truckMode");

        const carButton = $("carMode");

        if (truckButton) {
            truckButton.className =
                state.profile === "truck" ? "nav-btn primary" : "nav-btn";
        }

        if (carButton) {
            carButton.className =
                state.profile === "car" ? "nav-btn primary" : "nav-btn";
        }

        const calculate = $("calcRoute");

        if (calculate) {
            calculate.textContent =
                state.profile === "truck"
                    ? "Izračunaj truck rutu"
                    : "Izračunaj auto rutu";
        }

        const truckFields = [
            "truckPreset",
            "navWeight",
            "navHeight",
            "navWidth",
            "navLength",
            "navAxleLoad",
            "navAxles",
            "navMaxSpeed",
            "navAdrClass",
            "navHazmat",
        ];

        for (const id of truckFields) {
            const element = $(id);

            if (element) {
                element.disabled = state.profile !== "truck";
            }
        }
    }

    function loadTruckPreset() {
        const values = {
            navWeight: "40",
            navHeight: "4",
            navWidth: "2.55",
            navLength: "16.5",
            navAxleLoad: "10",
            navAxles: "5",
            navMaxSpeed: "90",
        };

        for (const [id, value] of Object.entries(values)) {
            const element = $(id);

            if (element) {
                element.value = value;
            }
        }

        const hazmat = $("navHazmat");

        if (hazmat) {
            hazmat.checked = false;
        }

        const adr = $("navAdrClass");

        if (adr) {
            adr.value = "";
        }

        const avoid = $("navAvoid");

        if (avoid) {
            avoid.checked = true;
        }
    }

    function swapPoints() {
        const startInput = $("navStart");

        const endInput = $("navEnd");

        if (!startInput || !endInput) {
            return;
        }

        const text = startInput.value;

        startInput.value = endInput.value;

        endInput.value = text;

        const point = state.start;

        state.start = state.end;

        state.end = point;

        setText(
            "navStartResolved",
            state.start
                ? `${state.start.lat.toFixed(6)}, ${state.start.lon.toFixed(6)}`
                : "Čeka se lokacija…",
        );

        setText(
            "navEndResolved",
            state.end
                ? `${state.end.lat.toFixed(6)}, ${state.end.lon.toFixed(6)}`
                : "Čeka se lokacija…",
        );

        updateMarkers();
    }

    function attachAutocomplete(inputId, suggestionsId, resolvedId) {
        const input = $(inputId);

        if (!input) {
            return;
        }

        let timer = null;

        input.addEventListener("input", () => {
            clearTimeout(timer);

            timer = setTimeout(
                () => autocomplete(inputId, suggestionsId, resolvedId),
                350,
            );
        });

        input.addEventListener("blur", () => {
            setTimeout(() => {
                const box = $(suggestionsId);

                if (box) {
                    box.style.display = "none";
                }
            }, 250);
        });
    }

    function attachEvents() {
        $("calcRoute")?.addEventListener("click", calculateRoute);

        $("clearRoute")?.addEventListener("click", clearRoute);

        $("fitRoute")?.addEventListener("click", fitRoute);

        $("centerGps")?.addEventListener("click", () => {
            const position = window.ProMap?.Gps?.getPosition?.();

            const normalized = normalizeGpsPosition(position);

            if (normalized && state.map) {
                state.map.setView([normalized.latitude, normalized.longitude], 15);
            }
        });

        $("useCurrentLocation")?.addEventListener("click", useCurrentLocation);

        $("startLiveNavigation")?.addEventListener("click", startLiveNavigation);

        $("stopLiveNavigation")?.addEventListener("click", stopLiveNavigation);

        $("truckMode")?.addEventListener("click", () => setProfile("truck"));

        $("carMode")?.addEventListener("click", () => setProfile("car"));

        $("truckPreset")?.addEventListener("change", loadTruckPreset);

        $("truckPreset")?.addEventListener("click", loadTruckPreset);

        $("swapPoints")?.addEventListener("click", swapPoints);

        $("pickStart")?.addEventListener("click", () => {
            state.mapPickTarget = "start";

            setNavigationStatus("PICK START", "warning");
        });

        $("pickEnd")?.addEventListener("click", () => {
            state.mapPickTarget = "end";

            setNavigationStatus("PICK DESTINATION", "warning");
        });

        attachAutocomplete("navStart", "navStartSuggestions", "navStartResolved");

        attachAutocomplete("navEnd", "navEndSuggestions", "navEndResolved");

        $("navStart")?.addEventListener("change", () => {
            const input = $("navStart");

            if (!input) {
                return;
            }

            const point = parseCoordinates(input.value);

            if (point) {
                state.start = point;

                setText(
                    "navStartResolved",
                    `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`,
                );

                updateStartMarker();
            }
        });

        $("navEnd")?.addEventListener("change", () => {
            const input = $("navEnd");

            if (!input) {
                return;
            }

            const point = parseCoordinates(input.value);

            if (point) {
                state.end = point;

                setText(
                    "navEndResolved",
                    `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`,
                );

                updateEndMarker();
            }
        });
    }

    function initialize() {
        initializeMap();
        attachEvents();
        loadTruckPreset();

        setProfile("truck");

        state.start = normalizePoint(DEFAULTS.start);

        state.end = normalizePoint(DEFAULTS.end);

        if (state.start) {
            setText(
                "navStartResolved",
                `${state.start.lat.toFixed(6)}, ${state.start.lon.toFixed(6)}`,
            );
        }

        if (state.end) {
            setText(
                "navEndResolved",
                `${state.end.lat.toFixed(6)}, ${state.end.lon.toFixed(6)}`,
            );
        }

        const startInput = $("navStart");

        if (startInput && !startInput.value.trim()) {
            startInput.value = DEFAULTS.start.label;
        }

        const endInput = $("navEnd");

        if (endInput && !endInput.value.trim()) {
            endInput.value = DEFAULTS.end.label;
        }

        updateMarkers();

        if (state.map && state.start && state.end) {
            state.map.fitBounds(
                [
                    [state.start.lat, state.start.lon],
                    [state.end.lat, state.end.lon],
                ],
                {
                    padding: [50, 50],
                },
            );
        }

        setNavigationStatus("READY", "ready");

        setGpsStatus("GPS OFF");

        setText("summaryDiagnostics", "Spreman za routing.");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, {
            once: true,
        });
    } else {
        initialize();
    }
})();
