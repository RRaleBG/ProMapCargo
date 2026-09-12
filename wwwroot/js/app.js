const state = {
    theme: localStorage.getItem("pm-theme") || "emerald",
    page: location.pathname,
};
document.documentElement.dataset.theme = state.theme;
const esc = (v) =>
    String(v ?? "").replace(
        /[&<>"']/g,
        (m) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
            m
            ],
    );
const nav = [
    ["/dispatch", "Command Center"],
    ["/orders", "Transportni nalozi"],
    ["/trips", "Ture"],
    ["/vehicles", "Vozila"],
    ["/drivers", "Vozači"],
    ["/navigation", "Navigacija"],
    ["/alerts", "Alerts"],
    ["/moderation", "Moderacija"],
    ["/audit", "Audit"],
    ["/settings", "Podešavanja"],
    ["/profile", "Profil"],
    ["/logout", "Odjava"],
    ["/login", "Login"],
    ["/register", "Register"],
    ["/forgot-password", "Forgot Password"],
    ["/order/:id", "Order Details"],
    ["report/:id", "Report Details"],
];

function shell(content) {
    document.getElementById("app").innerHTML =
        `<div class="min-h-screen flex"><aside class="hidden lg:flex w-64 shrink-0 surface border-r border-pm flex-col"><div class="p-5 border-b border-pm"><div class="text-xl font-black">ProMap <span class="accent">Cargo</span></div><div class="text-[11px] muted mt-1">Transport · Fleet · Navigation</div></div><nav class="p-3 space-y-1">${nav.map((n) => `<a href="${n[0]}" class="nav block ${state.page.startsWith(n[0]) ? "active" : ""}">${n[1]}</a>`).join("")}</nav><div class="mt-auto p-4 border-t border-pm"><div class="text-[10px] uppercase muted">Routing engine</div><div class="font-bold text-sm mt-1">PostGIS · OSM · Truck-aware</div><div class="text-[11px] muted mt-1">Graph version protected</div></div></aside><main class="flex-1 min-w-0"><header class="h-16 sticky top-0 z-30 surface/90 backdrop-blur border-b border-pm flex items-center justify-between px-4 lg:px-7"><div><div class="font-black text-sm">${title()}</div><div class="text-[11px] muted">Live operations control</div></div><div class="flex gap-2"><button class="btn" id="theme">${state.theme === "emerald" ? "White" : "Emerald Dark"}</button><a class="btn" href="/profile">Profile</a></div></header><section class="p-4 lg:p-7">${content}</section></main></div><div class="lg:hidden fixed bottom-0 inset-x-0 z-50 surface border-t border-pm p-2 flex justify-around">${nav
            .slice(0, 5)
            .map(
                (n) =>
                    `<a href="${n[0]}" class="text-[10px] muted px-2 py-2">${n[1]}</a>`,
            )
            .join("")}</div>`;
    document.getElementById("theme").onclick = () => {
        state.theme = state.theme === "emerald" ? "white" : "emerald";
        localStorage.setItem("pm-theme", state.theme);
        document.documentElement.dataset.theme = state.theme;
        render();
    };
}

function title() {
    return nav.find((x) => state.page.startsWith(x[0]))?.[1] || "Command Center";
}

function kpi(label, value, sub = "") {
    return `<div class="card p-4"><div class="text-[10px] uppercase tracking-wider muted">${label}</div><div class="text-2xl font-black mt-1">${value}</div><div class="text-[11px] muted mt-1">${sub}</div></div>`;
}

function dispatch() {
    shell(
        `<div class="grid grid-cols-2 xl:grid-cols-6 gap-3 mb-5">${kpi("Aktivne ture", "12", "operativno")}${kpi("GPS online", "38", "fleet")}${kpi("GPS lost", "2", "zahteva pažnju")}${kpi("Off-route", "1", "automatski alert")}${kpi("Border waiting", "3", "u toku")}${kpi("Compliance", "2", "otvoreno")}</div><div class="grid xl:grid-cols-[minmax(0,1fr)_390px] gap-5"><div class="card overflow-hidden"><div class="p-4 border-b border-pm flex justify-between"><div><b>Live Fleet Map</b><div class="text-[11px] muted mt-1">Vozila · rute · granice · stopovi</div></div><span class="px-2 py-1 rounded-full text-[10px] font-black" style="background:var(--surface2);color:var(--accent)">LIVE</span></div><div id="map" class="h-[calc(100vh-230px)] min-h-[500px]"></div></div><div class="space-y-4"><div class="card p-4"><div class="flex justify-between mb-3"><b>Active trips</b><span class="text-[10px] muted">12</span></div>${["BG-241-AA · Beograd → München", "NS-882-KK · Novi Sad → Graz", "NI-401-TT · Niš → Zagreb", "KG-119-MP · Kragujevac → Milano"].map((x, i) => `<div class="p-3 rounded-xl surface2 mb-2"><div class="text-xs font-bold">${x}</div><div class="flex justify-between text-[10px] muted mt-2"><span>${i === 0 ? "IN TRANSIT" : "APPROACHING STOP"}</span><span>${68 - i * 11}%</span></div><div class="h-1.5 rounded-full mt-2" style="background:var(--bg)"><div class="h-full rounded-full" style="width:${68 - i * 11}%;background:var(--primary)"></div></div></div>`).join("")}</div><div class="card p-4"><b>Alerts</b><div class="mt-3 space-y-2"><div class="p-3 rounded-xl border border-pm"><span class="accent font-black text-[10px]">OFF-ROUTE</span><div class="text-xs mt-1">BG-241-AA · 84 m od rute</div></div><div class="p-3 rounded-xl border border-pm"><span class="accent font-black text-[10px]">BORDER</span><div class="text-xs mt-1">Horgoš · čekanje 31 min</div></div></div></div></div></div>`,
    );
    setTimeout(() => {
        const m = L.map("map").setView([44.9, 20.8], 7);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OpenStreetMap",
        }).addTo(m);
        [
            [44.8178, 20.4573, "BG-241-AA"],
            [45.2551, 19.8335, "NS-882-KK"],
            [43.32, 21.9, "NI-401-TT"],
        ].forEach((x) =>
            L.marker([x[0], x[1]])
                .addTo(m)
                .bindPopup(`<b>${x[2]}</b><br>Truck · LIVE`),
        );
    }, 20);
}

const navigationRuntime = {
    map: null,
    routeLayers: [],
    startMarker: null,
    destinationMarker: null,
    positionMarker: null,
    routeResponse: null,
    selectedRouteIndex: 0,
    routeCoordinates: [],
    maneuvers: [],
    mapPickTarget: null,
    watchId: null,
    lastRerouteAt: 0,
    isRouting: false,
    profile: "truck",
};

function planner() {
    shell(`
        <div class="grid 2xl:grid-cols-[430px_minmax(0,1fr)_360px] xl:grid-cols-[410px_minmax(0,1fr)] gap-5">

            <!-- LEFT PANEL -->
            <aside class="space-y-4">

                <div class="card p-4">

                    <div class="flex items-start justify-between gap-3 mb-4">
                        <div>
                            <div class="text-lg font-black">
                                Truck Navigation
                            </div>

                            <div class="text-[11px] muted mt-1">
                                OSM · PostGIS · OSRM fallback · restrictions
                            </div>
                        </div>

                        <span
                            id="navStatus"
                            class="text-[10px] font-black px-2 py-1 rounded-full surface2">
                            READY
                        </span>
                    </div>

                    <!-- PROFILE -->
                    <div class="grid grid-cols-2 gap-2 mb-4">

                        <button
                            id="profileTruck"
                            class="btn-primary">
                            Kamion
                        </button>

                        <button
                            id="profileCar"
                            class="btn">
                            Auto
                        </button>

                    </div>

                    <!-- LOCATIONS -->
                    <div class="space-y-3">

                        ${locationInputHtml(
        "start",
        "START",
        "Beograd, Srbija",
    )}

                        <div class="flex justify-center -my-1">

                            <button
                                id="swapPoints"
                                class="btn !py-1 !px-3"
                                title="Zameni start i destinaciju">

                                ⇅ Zameni

                            </button>

                        </div>

                        ${locationInputHtml(
        "destination",
        "DESTINACIJA",
        "Novi Sad, Srbija",
    )}

                    </div>

                    <!-- TRUCK PROFILE -->
                    <div
                        id="truckPanel"
                        class="mt-5 pt-4 border-t border-pm">

                        <div class="flex items-center justify-between mb-3">

                            <div class="text-xs font-black">
                                Profil kamiona
                            </div>

                            <button
                                id="truckPreset"
                                class="text-[10px] accent font-bold">

                                40t standard

                            </button>

                        </div>

                        <div class="grid grid-cols-2 gap-2">

                            <label class="text-[10px] muted">

                                Masa (t)

                                <input
                                    id="weight"
                                    type="number"
                                    min="1"
                                    step="0.1"
                                    class="field mt-1"
                                    value="40">

                            </label>

                            <label class="text-[10px] muted">

                                Visina (m)

                                <input
                                    id="height"
                                    type="number"
                                    min="1"
                                    step="0.01"
                                    class="field mt-1"
                                    value="4.00">

                            </label>

                            <label class="text-[10px] muted">

                                Širina (m)

                                <input
                                    id="width"
                                    type="number"
                                    min="1"
                                    step="0.01"
                                    class="field mt-1"
                                    value="2.55">

                            </label>

                            <label class="text-[10px] muted">

                                Dužina (m)

                                <input
                                    id="length"
                                    type="number"
                                    min="1"
                                    step="0.1"
                                    class="field mt-1"
                                    value="16.50">

                            </label>

                            <label class="text-[10px] muted">

                                Osovinsko opterećenje (t)

                                <input
                                    id="axleLoad"
                                    type="number"
                                    min="1"
                                    step="0.1"
                                    class="field mt-1"
                                    value="10">

                            </label>

                            <label class="text-[10px] muted">

                                Broj osovina

                                <input
                                    id="axles"
                                    type="number"
                                    min="2"
                                    max="12"
                                    class="field mt-1"
                                    value="5">

                            </label>

                            <label class="text-[10px] muted">

                                Max brzina

                                <input
                                    id="maxSpeed"
                                    type="number"
                                    min="10"
                                    max="140"
                                    class="field mt-1"
                                    value="90">

                            </label>

                            <label class="text-[10px] muted">

                                ADR klasa

                                <input
                                    id="adrClass"
                                    class="field mt-1"
                                    placeholder="npr. 3">

                            </label>

                        </div>

                        <div class="grid gap-2 mt-3">

                            <label class="flex gap-2 items-center text-xs muted">

                                <input
                                    id="hazmat"
                                    type="checkbox">

                                ADR / opasna roba

                            </label>

                            <label class="flex gap-2 items-center text-xs muted">

                                <input
                                    id="avoid"
                                    type="checkbox"
                                    checked>

                                Izbegni aktivne restrikcije

                            </label>

                        </div>

                    </div>

                    <button
                        id="calculateRoute"
                        class="btn-primary w-full mt-5">

                        Izračunaj rutu

                    </button>

                    <div
                        id="routeError"
                        class="hidden mt-3 rounded-xl border border-pm p-3 text-xs">
                    </div>

                </div>

                <!-- SUMMARY -->
                <div
                    id="routeSummaryCard"
                    class="card p-4 hidden">

                    <div class="flex items-center justify-between mb-3">

                        <b>Sažetak rute</b>

                        <span
                            id="safetyBadge"
                            class="text-[10px] font-black px-2 py-1 rounded-full">
                        </span>

                    </div>

                    <div class="grid grid-cols-3 gap-2">

                        ${miniStat("summaryDistance", "—", "DISTANCA")}

                        ${miniStat("summaryDuration", "—", "VREME")}

                        ${miniStat("summaryEta", "—", "DOLAZAK")}

                    </div>

                    <div
                        id="routeDiagnostics"
                        class="text-[10px] muted mt-3">
                    </div>

                </div>

            </aside>


            <!-- MAP -->
            <section
                class="card overflow-hidden relative min-h-[720px]">

                <div
                    class="absolute top-3 left-3 right-3 z-[500] flex justify-between pointer-events-none">

                    <!-- NEXT INSTRUCTION -->
                    <div
                        id="nextInstruction"
                        class="hidden pointer-events-auto surface rounded-2xl border border-pm shadow-xl px-4 py-3 max-w-[460px]">

                        <div class="text-[10px] uppercase muted">
                            Sledeće
                        </div>

                        <div
                            id="nextInstructionText"
                            class="font-black mt-1">
                            —
                        </div>

                        <div
                            id="nextInstructionDistance"
                            class="text-xs muted mt-1">
                        </div>

                    </div>

                    <div class="pointer-events-auto flex gap-2 ml-auto">

                        <button
                            id="locateMe"
                            class="btn">

                            ◎ Moja lokacija

                        </button>

                        <button
                            id="fitRoute"
                            class="btn">

                            ⤢ Cela ruta

                        </button>

                    </div>

                </div>

                <div
                    id="navigationMap"
                    class="h-[calc(100vh-150px)] min-h-[720px]">
                </div>

                <div
                    class="absolute bottom-4 left-1/2 -translate-x-1/2 z-[500] flex gap-2">

                    <button
                        id="startNavigation"
                        class="btn-primary shadow-xl"
                        disabled>

                        ▶ Pokreni navigaciju

                    </button>

                    <button
                        id="stopNavigation"
                        class="btn shadow-xl hidden">

                        ■ Zaustavi

                    </button>

                </div>

            </section>


            <!-- RIGHT PANEL -->
            <aside
                class="space-y-4 2xl:block xl:col-span-2 2xl:col-span-1">

                <!-- ALTERNATIVES -->
                <div
                    id="alternativesCard"
                    class="card p-4 hidden">

                    <div class="flex items-center justify-between mb-3">

                        <b>Alternative</b>

                        <span
                            id="alternativeCount"
                            class="text-[10px] muted">
                        </span>

                    </div>

                    <div
                        id="routeAlternatives"
                        class="space-y-2">
                    </div>

                </div>


                <!-- WARNINGS -->
                <div
                    id="warningsCard"
                    class="card p-4 hidden">

                    <div class="flex items-center justify-between mb-3">

                        <b>Upozorenja</b>

                        <span
                            id="warningCount"
                            class="text-[10px] muted">
                        </span>

                    </div>

                    <div
                        id="routeWarnings"
                        class="space-y-2">
                    </div>

                </div>


                <!-- MANEUVERS -->
                <div
                    id="maneuversCard"
                    class="card p-4 hidden">

                    <div class="flex items-center justify-between mb-3">

                        <b>Turn-by-turn</b>

                        <span
                            id="maneuverCount"
                            class="text-[10px] muted">
                        </span>

                    </div>

                    <div
                        id="maneuverList"
                        class="space-y-2 max-h-[500px] overflow-auto pr-1">
                    </div>

                </div>

            </aside>

        </div>
    `);

    navigationRuntime.profile = "truck";
    navigationRuntime.routeResponse = null;
    navigationRuntime.selectedRouteIndex = 0;
    navigationRuntime.routeCoordinates = [];
    navigationRuntime.maneuvers = [];
    navigationRuntime.mapPickTarget = null;
    navigationRuntime.isRouting = false;

    initNavigationMap();
    wireNavigationUi();
}

function locationInputHtml(id, label, placeholder) {
    return `

        <div class="relative">

            <div class="flex items-center justify-between mb-1">

                <label class="text-[10px] muted">
                    ${label}
                </label>

                <button
                    type="button"
                    class="text-[10px] accent font-bold"
                    data-map-pick="${id}">

                    Izaberi na mapi

                </button>

            </div>

            <input
                id="${id}Search"
                class="field"
                autocomplete="off"
                placeholder="${placeholder}">

            <input
                id="${id}Lat"
                type="hidden">

            <input
                id="${id}Lon"
                type="hidden">

            <div
                id="${id}Results"
                class="hidden absolute z-[700] left-0 right-0 mt-1 surface border border-pm rounded-xl overflow-hidden shadow-2xl">
            </div>

        </div>
    `;
}

function miniStat(id, value, label) {
    return `

        <div class="surface2 rounded-xl p-3">

            <div
                id="${id}"
                class="font-black text-sm">

                ${value}

            </div>

            <div class="text-[9px] muted mt-1">
                ${label}
            </div>

        </div>
    `;
}

function initNavigationMap() {
    if (navigationRuntime.map) {
        try {
            navigationRuntime.map.remove();
        } catch (_) { }
    }

    const map = L.map("navigationMap", {
        zoomControl: false,
    }).setView([44.8178, 20.4573], 7);

    L.control
        .zoom({
            position: "bottomright",
        })
        .addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    map.on("click", (e) => {
        if (!navigationRuntime.mapPickTarget) return;

        setWaypoint(
            navigationRuntime.mapPickTarget,
            e.latlng.lat,
            e.latlng.lng,
            `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`,
        );

        navigationRuntime.mapPickTarget = null;

        setNavigationStatus("READY");
    });

    navigationRuntime.map = map;
}

function wireNavigationUi() {
    setupGeocoder("start");

    setupGeocoder("destination");

    document.querySelectorAll("[data-map-pick]").forEach((button) => {
        button.addEventListener("click", () => {
            navigationRuntime.mapPickTarget = button.dataset.mapPick;

            setNavigationStatus(
                `MAP PICK: ${navigationRuntime.mapPickTarget === "start" ? "START" : "DESTINATION"
                }`,
            );
        });
    });

    document.getElementById("profileTruck").onclick = () =>
        setNavigationProfile("truck");

    document.getElementById("profileCar").onclick = () =>
        setNavigationProfile("car");

    document.getElementById("calculateRoute").onclick = () =>
        calculateNavigationRoute();

    document.getElementById("fitRoute").onclick = fitNavigationRoute;

    document.getElementById("locateMe").onclick = locateNavigationUser;

    document.getElementById("startNavigation").onclick = startLiveNavigation;

    document.getElementById("stopNavigation").onclick = stopLiveNavigation;

    document.getElementById("truckPreset").onclick = applyStandardTruckPreset;

    document.getElementById("swapPoints").onclick = () => {
        const a = readWaypoint("start");

        const b = readWaypoint("destination");

        const aText = document.getElementById("startSearch").value;

        const bText = document.getElementById("destinationSearch").value;

        if (b) {
            setWaypoint("start", b.lat, b.lon, bText);
        } else {
            clearWaypoint("start");
        }

        if (a) {
            setWaypoint("destination", a.lat, a.lon, aText);
        } else {
            clearWaypoint("destination");
        }
    };
}

function setNavigationProfile(profile) {
    navigationRuntime.profile = profile;

    const truck = profile === "truck";

    document.getElementById("truckPanel").classList.toggle("hidden", !truck);

    document.getElementById("profileTruck").className = truck
        ? "btn-primary"
        : "btn";

    document.getElementById("profileCar").className = truck
        ? "btn"
        : "btn-primary";
}

function applyStandardTruckPreset() {
    weight.value = 40;

    height.value = 4;

    width.value = 2.55;

    length.value = 16.5;

    axleLoad.value = 10;

    axles.value = 5;

    maxSpeed.value = 90;

    hazmat.checked = false;

    adrClass.value = "";
}

function normalizeGeocodeResults(payload) {
    const raw = Array.isArray(payload)
        ? payload
        : payload?.results ?? payload?.items ?? payload?.data ?? [];

    if (!Array.isArray(raw)) return [];

    return raw.map(item => {
        const lat = Number(item?.lat ?? item?.latitude);
        const lon = Number(item?.lon ?? item?.lng ?? item?.longitude);
        const displayName = String(
            item?.displayName ??
            item?.display_Name ??
            item?.display_name ??
            item?.name ??
            item?.label ??
            `${lat}, ${lon}`
        ).trim();

        return {
            ...item,
            lat,
            lon,
            displayName
        };
    }).filter(item =>
        Number.isFinite(item.lat) &&
        Number.isFinite(item.lon) &&
        item.lat >= -90 && item.lat <= 90 &&
        item.lon >= -180 && item.lon <= 180
    );
}

function parseNavigationCoordinates(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;

    // Supports: "44.8178, 20.4573" and "44.8178 20.4573".
    const match = text.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    if (!match) return null;

    let first = Number(match[1].replace(',', '.'));
    let second = Number(match[2].replace(',', '.'));
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

    // Normal order is lat,lon. Also accept lon,lat when it is unambiguous.
    if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
        [first, second] = [second, first];
    }

    if (
        first < -90 || first > 90 ||
        second < -180 || second > 180
    ) {
        return null;
    }

    return { lat: first, lon: second };
}

function isValidNavigationPoint(point) {
    return !!point &&
        Number.isFinite(Number(point.lat)) &&
        Number.isFinite(Number(point.lon)) &&
        Number(point.lat) >= -90 && Number(point.lat) <= 90 &&
        Number(point.lon) >= -180 && Number(point.lon) <= 180;
}

async function geocodeNavigationQuery(query) {
    const q = String(query ?? '').trim();
    if (q.length < 2) return [];

    const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(q)}&limit=6`,
        {
            headers: { 'Accept': 'application/json' }
        }
    );

    const responseText = await response.text();
    let payload = null;
    try {
        payload = responseText ? JSON.parse(responseText) : null;
    } catch (_) {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(
            payload?.message ||
            payload?.title ||
            responseText ||
            `Geocoding HTTP ${response.status}`
        );
    }

    return normalizeGeocodeResults(payload);
}

async function resolveNavigationLocation(kind) {
    const input = document.getElementById(`${kind}Search`);
    const query = input?.value?.trim() ?? '';

    if (!query) {
        throw new Error(`${kind === 'start' ? 'START' : 'DESTINACIJA'} nije uneta.`);
    }

    // Coordinates do not need geocoding.
    const coordinates = parseNavigationCoordinates(query);
    if (coordinates) {
        setWaypoint(kind, coordinates.lat, coordinates.lon, query);
        return coordinates;
    }

    const locations = await geocodeNavigationQuery(query);
    if (!locations.length) {
        throw new Error(`Nije pronađena lokacija za: "${query}"`);
    }

    // Use the first result for the Calculate button. Autocomplete still allows
    // the operator to explicitly select another candidate before routing.
    const location = locations[0];
    const point = {
        lat: Number(location.lat),
        lon: Number(location.lon)
    };

    if (!isValidNavigationPoint(point)) {
        throw new Error(`Geocoder je vratio nevalidne koordinate za: "${query}"`);
    }

    const label = location.displayName || query;
    setWaypoint(kind, point.lat, point.lon, label);
    return point;
}

function setupGeocoder(kind) {
    const input = document.getElementById(`${kind}Search`);
    const results = document.getElementById(`${kind}Results`);

    if (!input || !results) return;

    let timer = null;
    let controller = null;

    input.addEventListener("input", () => {
        document.getElementById(`${kind}Lat`).value = "";
        document.getElementById(`${kind}Lon`).value = "";

        clearTimeout(timer);
        controller?.abort();

        const query = input.value.trim();
        if (query.length < 2) {
            results.classList.add("hidden");
            return;
        }

        // Coordinate input can be resolved immediately without an API call.
        const coordinates = parseNavigationCoordinates(query);
        if (coordinates) {
            setWaypoint(kind, coordinates.lat, coordinates.lon, query);
            results.classList.add("hidden");
            return;
        }

        timer = setTimeout(async () => {
            try {
                controller = new AbortController();

                const response = await fetch(
                    `/api/geocode?q=${encodeURIComponent(query)}&limit=6`,
                    {
                        signal: controller.signal,
                        headers: { "Accept": "application/json" }
                    }
                );

                const responseText = await response.text();
                let payload = null;
                try {
                    payload = responseText ? JSON.parse(responseText) : null;
                } catch (_) {
                    payload = null;
                }

                if (!response.ok) {
                    throw new Error(
                        payload?.message ||
                        payload?.title ||
                        responseText ||
                        `Geocoding HTTP ${response.status}`
                    );
                }

                const items = normalizeGeocodeResults(payload);

                if (!items.length) {
                    results.innerHTML = `
                        <div class="p-3 text-xs muted">Nema rezultata.</div>
                    `;
                    results.classList.remove("hidden");
                    return;
                }

                results.innerHTML = items.map((item, index) => {
                    const label = item.displayName;
                    return `
                        <button
                            type="button"
                            class="block w-full text-left p-3 border-b border-pm hover:surface2"
                            data-result="${index}">
                            <div class="text-xs font-bold">${esc(label)}</div>
                            <div class="text-[10px] muted mt-1">
                                ${esc(item.type ?? item.category ?? "")}
                                · ${Number(item.lat).toFixed(6)}, ${Number(item.lon).toFixed(6)}
                            </div>
                        </button>
                    `;
                }).join("");

                results.classList.remove("hidden");

                results.querySelectorAll("[data-result]").forEach(button => {
                    button.onclick = () => {
                        const item = items[Number(button.dataset.result)];
                        if (!item) return;

                        setWaypoint(
                            kind,
                            Number(item.lat),
                            Number(item.lon),
                            item.displayName
                        );

                        results.classList.add("hidden");
                    };
                });
            } catch (error) {
                if (error.name !== "AbortError") {
                    results.innerHTML = `
                        <div class="p-3 text-xs">
                            Geocoding trenutno nije dostupan: ${esc(error.message || "greška")}
                        </div>
                    `;
                    results.classList.remove("hidden");
                }
            }
        }, 350);
    });

    input.addEventListener("keydown", async event => {
        if (event.key === "Enter") {
            event.preventDefault();

            const first = results.querySelector("[data-result]");
            if (first) {
                first.click();
                return;
            }

            try {
                await resolveNavigationLocation(kind);
                results.classList.add("hidden");
            } catch (error) {
                showRouteError(error.message || "Lokacija nije pronađena.");
            }
        }

        if (event.key === "Escape") {
            results.classList.add("hidden");
        }
    });
}

function setWaypoint(kind, lat, lon, label) {
    document.getElementById(`${kind}Lat`).value = lat;

    document.getElementById(`${kind}Lon`).value = lon;

    document.getElementById(`${kind}Search`).value = label;

    const map = navigationRuntime.map;

    const markerName = kind === "start" ? "startMarker" : "destinationMarker";

    if (navigationRuntime[markerName]) {
        map.removeLayer(navigationRuntime[markerName]);
    }

    const icon = L.divIcon({
        className: "",

        html: `

                <div
                    style="
                        width:18px;
                        height:18px;
                        border-radius:999px;
                        background:${kind === "start" ? "#10b981" : "#ef4444"};
                        border:3px solid white;
                        box-shadow:0 2px 10px rgba(0,0,0,.35)">
                </div>
            `,

        iconSize: [18, 18],

        iconAnchor: [9, 9],
    });

    navigationRuntime[markerName] = L.marker([lat, lon], {
        icon,
    })
        .addTo(map)
        .bindPopup(kind === "start" ? "Start" : "Destinacija");

    if (readWaypoint("start") && readWaypoint("destination")) {
        fitWaypoints();
    } else {
        map.setView([lat, lon], Math.max(map.getZoom(), 11));
    }
}

function clearWaypoint(kind) {
    document.getElementById(`${kind}Lat`).value = "";

    document.getElementById(`${kind}Lon`).value = "";

    document.getElementById(`${kind}Search`).value = "";

    const markerName = kind === "start" ? "startMarker" : "destinationMarker";

    if (navigationRuntime[markerName]) {
        navigationRuntime.map.removeLayer(navigationRuntime[markerName]);

        navigationRuntime[markerName] = null;
    }
}

function readWaypoint(kind) {
    const lat = Number(document.getElementById(`${kind}Lat`).value);

    const lon = Number(document.getElementById(`${kind}Lon`).value);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        !document.getElementById(`${kind}Lat`).value
    ) {
        return null;
    }

    return {
        lat,
        lon,
    };
}

async function calculateNavigationRoute(options = {}) {
    if (navigationRuntime.isRouting) {
        return;
    }

    const startText = document.getElementById("startSearch")?.value?.trim() ?? "";
    const destinationText = document.getElementById("destinationSearch")?.value?.trim() ?? "";

    try {
        hideRouteError();
        setNavigationStatus("LOCATING…");
        calculateRoute.disabled = true;
        calculateRoute.textContent = "Pronalazim…";

        // The old implementation required hidden Lat/Lon fields to already be
        // populated. That made typing "Beograd, Srbija" and pressing Calculate
        // fail before /api/geocode was ever called. Resolve text here as well.
        let startPoint = readWaypoint("start");
        if (!isValidNavigationPoint(startPoint)) {
            if (!startText) {
                throw new Error("Unesite START lokaciju.");
            }
            startPoint = await resolveNavigationLocation("start");
        }

        let destinationPoint = readWaypoint("destination");
        if (!isValidNavigationPoint(destinationPoint)) {
            if (!destinationText) {
                throw new Error("Unesite DESTINACIJU.");
            }
            destinationPoint = await resolveNavigationLocation("destination");
        }

        if (!isValidNavigationPoint(startPoint) || !isValidNavigationPoint(destinationPoint)) {
            throw new Error("Start i destination moraju sadržati validne geografske koordinate.");
        }

        // Normalize hidden fields after automatic geocoding so the rest of the
        // navigation UI, map markers and subsequent recalculations use the same
        // canonical coordinates.
        setWaypoint(
            "start",
            Number(startPoint.lat),
            Number(startPoint.lon),
            document.getElementById("startSearch")?.value?.trim() || "START"
        );
        setWaypoint(
            "destination",
            Number(destinationPoint.lat),
            Number(destinationPoint.lon),
            document.getElementById("destinationSearch")?.value?.trim() || "DESTINACIJA"
        );

        startPoint = readWaypoint("start");
        destinationPoint = readWaypoint("destination");

        hideRouteError();
        navigationRuntime.isRouting = true;
        setNavigationStatus("ROUTING…");
        calculateRoute.textContent = "Računam…";

        const truck =
            navigationRuntime.profile === "truck"
                ? {
                    grossWeightTons: numberValue("weight"),
                    heightMeters: numberValue("height"),
                    widthMeters: numberValue("width"),
                    lengthMeters: numberValue("length"),
                    axleLoadTons: numberValue("axleLoad"),
                    axles: Math.round(numberValue("axles")),
                    isHgv: true,
                    commercial: true,
                    hazmat: document.getElementById("hazmat").checked,
                    adrClass: document.getElementById("adrClass").value.trim() || null,
                    vehicleClass: "HeavyGoods",
                    maxSpeedKmh: numberValue("maxSpeed"),
                }
                : null;

        const body = {
            start: {
                lat: Number(startPoint.lat),
                lon: Number(startPoint.lon),
            },
            destination: {
                lat: Number(destinationPoint.lat),
                lon: Number(destinationPoint.lon),
            },
            profile: navigationRuntime.profile,
            avoidRestricted:
                navigationRuntime.profile === "truck" &&
                document.getElementById("avoid").checked,
            truck,
            departureAt: new Date().toISOString(),
        };

        const response = await fetch("/api/route", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify(body),
        });

        let data = null;
        try {
            data = await response.json();
        } catch (_) { }

        if (!response.ok) {
            throw new Error(data?.message || `Routing HTTP ${response.status}`);
        }

        if (
            !data ||
            String(data.code).toLowerCase() !== "ok" ||
            !Array.isArray(data.routes) ||
            data.routes.length === 0
        ) {
            throw new Error(data?.message || "Ruta nije pronađena.");
        }

        navigationRuntime.routeResponse = data;
        navigationRuntime.selectedRouteIndex = Number.isInteger(data.selectedRouteIndex)
            ? data.selectedRouteIndex
            : 0;

        renderNavigationRoute(data, !options.keepViewport);
        setNavigationStatus(
            data.diagnostics?.usedFallback ? "OSRM FALLBACK" : "TRUCK GRAPH"
        );
    } catch (error) {
        showRouteError(error.message || "Routing servis nije dostupan.");
        setNavigationStatus("ERROR");
        console.error("Navigation routing error:", error);
    } finally {
        navigationRuntime.isRouting = false;
        calculateRoute.disabled = false;
        calculateRoute.textContent = "Izračunaj rutu";
    }
}

function renderNavigationRoute(data, fit = true) {
    clearRouteLayers();

    const map = navigationRuntime.map;

    data.routes.forEach((route, index) => {
        if (!route.geometry) return;

        const selected = index === navigationRuntime.selectedRouteIndex;

        const layer = L.geoJSON(route.geometry, {
            style: {
                color: selected ? "#10b981" : "#64748b",

                weight: selected ? 7 : 4,

                opacity: selected ? 0.95 : 0.55,
            },
        }).addTo(map);

        layer.on("click", () => selectNavigationAlternative(index));

        navigationRuntime.routeLayers.push(layer);
    });

    renderSelectedNavigationRoute();

    renderRouteAlternatives();

    document.getElementById("startNavigation").disabled = false;

    if (fit) {
        fitNavigationRoute();
    }
}

function renderSelectedNavigationRoute() {
    const data = navigationRuntime.routeResponse;

    const route = data?.routes?.[navigationRuntime.selectedRouteIndex];

    if (!route) return;

    navigationRuntime.routeLayers.forEach((layer, index) => {
        layer.setStyle?.({
            color:
                index === navigationRuntime.selectedRouteIndex ? "#10b981" : "#64748b",

            weight: index === navigationRuntime.selectedRouteIndex ? 7 : 4,

            opacity: index === navigationRuntime.selectedRouteIndex ? 0.95 : 0.55,
        });

        if (index === navigationRuntime.selectedRouteIndex) {
            layer.bringToFront?.();
        }
    });

    navigationRuntime.routeCoordinates = extractGeoJsonCoordinates(
        route.geometry,
    );

    navigationRuntime.maneuvers = buildManeuvers(data, route);

    const distance = route.distance ?? data.summary?.distanceMeters ?? 0;

    const duration = route.duration ?? data.summary?.durationSeconds ?? 0;

    const eta = data.summary?.estimatedArrival
        ? new Date(data.summary.estimatedArrival)
        : new Date(Date.now() + duration * 1000);

    document.getElementById("summaryDistance").textContent =
        formatDistance(distance);

    document.getElementById("summaryDuration").textContent =
        formatDuration(duration);

    document.getElementById("summaryEta").textContent = Number.isFinite(
        eta.getTime(),
    )
        ? eta.toLocaleTimeString("sr-RS", {
            hour: "2-digit",

            minute: "2-digit",
        })
        : "—";

    const safe = data.isTruckSafe !== false && !route.analysis?.restricted;

    const badge = document.getElementById("safetyBadge");

    badge.textContent =
        navigationRuntime.profile === "truck"
            ? safe
                ? "TRUCK SAFE"
                : "RESTRICTED"
            : "CAR ROUTE";

    badge.style.background = safe
        ? "rgba(16,185,129,.15)"
        : "rgba(239,68,68,.15)";

    badge.style.color = safe ? "#34d399" : "#f87171";

    const diagnostics = data.diagnostics || {};

    document.getElementById("routeDiagnostics").textContent = [
        diagnostics.engine ? `Engine: ${diagnostics.engine}` : null,

        diagnostics.graphVersion ? `Graph: ${diagnostics.graphVersion}` : null,

        diagnostics.usedFallback ? "Fallback: da" : "Fallback: ne",

        diagnostics.expandedStates
            ? `Expanded: ${Number(diagnostics.expandedStates).toLocaleString(
                "sr-RS",
            )}`
            : null,
    ]
        .filter(Boolean)
        .join(" · ");

    document.getElementById("routeSummaryCard").classList.remove("hidden");

    renderWarnings(data, route);

    renderManeuvers();

    updateNextInstruction(null);
}

function selectNavigationAlternative(index) {
    if (!navigationRuntime.routeResponse?.routes?.[index]) {
        return;
    }

    navigationRuntime.selectedRouteIndex = index;

    renderSelectedNavigationRoute();

    renderRouteAlternatives();
}

function renderRouteAlternatives() {
    const data = navigationRuntime.routeResponse;

    if (!data?.routes?.length) {
        return;
    }

    const card = document.getElementById("alternativesCard");

    card.classList.remove("hidden");

    document.getElementById("alternativeCount").textContent =
        `${data.routes.length} ruta`;

    document.getElementById("routeAlternatives").innerHTML = data.routes
        .map((route, index) => {
            const active = index === navigationRuntime.selectedRouteIndex;

            const restricted = route.analysis?.restricted;

            return `

                    <button
                        type="button"
                        data-route-index="${index}"
                        class="
                            w-full
                            text-left
                            rounded-xl
                            p-3
                            border
                            ${active ? "surface2" : ""}
                            border-pm
                        ">

                        <div class="flex justify-between gap-2">

                            <div class="text-xs font-black">

                                ${index === data.selectedRouteIndex
                    ? "Preporučena"
                    : `Alternativa ${index + 1}`
                }

                            </div>

                            <div
                                class="
                                    text-[10px]
                                    ${restricted ? "" : "accent"}
                                ">

                                ${restricted ? "OGRANIČENJA" : "OK"}

                            </div>

                        </div>

                        <div class="flex gap-4 text-[11px] muted mt-2">

                            <span>
                                ${formatDistance(route.distance)}
                            </span>

                            <span>
                                ${formatDuration(route.duration)}
                            </span>

                        </div>

                    </button>
                `;
        })
        .join("");

    document.querySelectorAll("[data-route-index]").forEach((button) => {
        button.onclick = () =>
            selectNavigationAlternative(Number(button.dataset.routeIndex));
    });
}

function renderWarnings(data, route) {
    const warnings = uniqueWarnings([
        ...(data.violations || []),

        ...(route.analysis?.violations || []),
    ]);

    const card = document.getElementById("warningsCard");

    const list = document.getElementById("routeWarnings");

    document.getElementById("warningCount").textContent = `${warnings.length}`;

    card.classList.remove("hidden");

    if (warnings.length === 0) {
        list.innerHTML = `

            <div class="rounded-xl p-3 surface2">

                <div class="text-xs font-black accent">
                    Nema detektovanih ograničenja
                </div>

                <div class="text-[10px] muted mt-1">
                    Ruta je prošla dostupne truck provere.
                </div>

            </div>
        `;

        return;
    }

    list.innerHTML = warnings
        .map(
            (warning) => `

                <div class="rounded-xl border border-pm p-3">

                    <div
                        class="text-[10px] font-black"
                        style="color:#f87171">

                        ${esc(warning.type || "RESTRICTION")}

                    </div>

                    <div class="text-xs font-bold mt-1">

                        ${esc(warning.name || "Ograničenje")}

                    </div>

                    <div class="text-[10px] muted mt-1">

                        ${esc(warning.reason || "")}

                    </div>

                </div>
            `,
        )
        .join("");
}

function renderManeuvers() {
    const list = document.getElementById("maneuverList");

    const card = document.getElementById("maneuversCard");

    const maneuvers = navigationRuntime.maneuvers;

    card.classList.remove("hidden");

    document.getElementById("maneuverCount").textContent = `${maneuvers.length}`;

    if (!maneuvers.length) {
        list.innerHTML = `

            <div class="text-xs muted">
                Routing engine nije vratio turn-by-turn korake.
            </div>
        `;

        return;
    }

    list.innerHTML = maneuvers
        .map(
            (maneuver, index) => `

                <button
                    type="button"
                    data-maneuver="${index}"
                    class="
                        w-full
                        text-left
                        rounded-xl
                        border
                        border-pm
                        p-3
                    ">

                    <div class="flex gap-3">

                        <div class="text-lg leading-none w-6 text-center">

                            ${maneuverIcon(maneuver.type, maneuver.modifier)}

                        </div>

                        <div class="min-w-0 flex-1">

                            <div class="text-xs font-bold">

                                ${esc(maneuver.instruction)}

                            </div>

                            <div class="text-[10px] muted mt-1">

                                ${formatDistance(maneuver.distance)}

                                ${maneuver.roadName
                    ? ` · ${esc(maneuver.roadName)}`
                    : ""
                }

                            </div>

                        </div>

                    </div>

                </button>
            `,
        )
        .join("");

    document.querySelectorAll("[data-maneuver]").forEach((button) => {
        button.onclick = () => {
            const maneuver = maneuvers[Number(button.dataset.maneuver)];

            if (Number.isFinite(maneuver.lat) && Number.isFinite(maneuver.lon)) {
                navigationRuntime.map.setView([maneuver.lat, maneuver.lon], 16);
            }
        };
    });
}

function buildManeuvers(data, route) {
    /*
          PostGIS routing engine vraća:
          data.maneuvers
  
          OSRM fallback vraća:
          route.legs[].steps[]
      */

    if (Array.isArray(data.maneuvers) && data.maneuvers.length) {
        return data.maneuvers.map((maneuver) => ({
            type: maneuver.type,

            modifier: null,

            instruction:
                maneuver.instruction ||
                localInstruction(maneuver.type, null, maneuver.roadName),

            distance: maneuver.distanceFromPreviousMeters || 0,

            lat: maneuver.latitude,

            lon: maneuver.longitude,

            roadName: maneuver.roadName || maneuver.roadRef || "",
        }));
    }

    const steps = (route.legs || []).flatMap((leg) => leg.steps || []);

    return steps.map((step) => {
        const maneuver = step.maneuver || {};
        const location = maneuver.location || [];

        return {
            type: maneuver.type || "continue",
            modifier: maneuver.modifier || null,
            instruction: localInstruction(
                maneuver.type,
                maneuver.modifier,
                step.name,
            ),

            distance: step.distance || 0,
            duration: step.duration || 0,
            lat: Number(location[1]),
            lon: Number(location[0]),
            roadName: step.name || "",
        };
    });
}

function localInstruction(type = "continue", modifier, roadName) {
    const road = roadName ? ` na ${roadName}` : "";

    if (type === "depart") {
        return `Krenite${road}`;
    }

    if (type === "arrive") {
        return "Stigli ste na destinaciju";
    }

    if (type === "roundabout" || type === "rotary") {
        return `Uđite u kružni tok${road}`;
    }

    if (type === "merge") {
        return `Uključite se${road}`;
    }

    if (type === "on ramp") {
        return `Uključite se na rampu${road}`;
    }

    if (type === "off ramp") {
        return `Isključite se sa puta${road}`;
    }

    if (type === "fork") {
        return modifier?.includes("left")
            ? `Držite se levo${road}`
            : `Držite se desno${road}`;
    }

    if (modifier?.includes("uturn")) {
        return `Okrenite se polukružno${road}`;
    }

    if (modifier?.includes("left")) {
        return `Skrenite levo${road}`;
    }

    if (modifier?.includes("right")) {
        return `Skrenite desno${road}`;
    }

    return `Nastavite pravo${road}`;
}

function maneuverIcon(type, modifier) {
    if (type === "arrive") {
        return "●";
    }

    if (type === "depart") {
        return "↑";
    }

    if (type === "roundabout" || type === "rotary") {
        return "⟳";
    }

    if (modifier?.includes("uturn")) {
        return "↶";
    }

    if (modifier?.includes("left")) {
        return "←";
    }

    if (modifier?.includes("right")) {
        return "→";
    }

    return "↑";
}

function extractGeoJsonCoordinates(geometry) {
    if (!geometry) return [];

    if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
        return geometry.coordinates
            .map((coordinate) => ({
                lat: Number(coordinate[1]),

                lon: Number(coordinate[0]),
            }))
            .filter(
                (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon),
            );
    }

    return [];
}

function clearRouteLayers() {
    for (const layer of navigationRuntime.routeLayers) {
        try {
            navigationRuntime.map.removeLayer(layer);
        } catch (_) { }
    }

    navigationRuntime.routeLayers = [];
}

function fitWaypoints() {
    const start = readWaypoint("start");

    const destination = readWaypoint("destination");

    if (start && destination) {
        navigationRuntime.map.fitBounds(
            [
                [start.lat, start.lon],
                [destination.lat, destination.lon],
            ],
            {
                padding: [60, 60],
            },
        );
    }
}

function fitNavigationRoute() {
    const selected =
        navigationRuntime.routeLayers[navigationRuntime.selectedRouteIndex];

    if (selected?.getBounds?.().isValid()) {
        navigationRuntime.map.fitBounds(selected.getBounds(), {
            padding: [55, 55],
        });
    } else {
        fitWaypoints();
    }
}

function locateNavigationUser() {
    if (!navigator.geolocation) {
        showRouteError("Browser ne podržava geolokaciju.");

        return;
    }

    setNavigationStatus("LOCATING…");

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;

            setWaypoint("start", latitude, longitude, "Moja lokacija");

            setCurrentPositionMarker(latitude, longitude, position.coords.heading);

            navigationRuntime.map.setView([latitude, longitude], 14);

            setNavigationStatus("READY");
        },

        (error) => {
            showRouteError(`Lokacija nije dostupna: ${error.message}`);

            setNavigationStatus("READY");
        },

        {
            enableHighAccuracy: true,

            timeout: 12000,

            maximumAge: 5000,
        },
    );
}

function startLiveNavigation() {
    if (!navigationRuntime.routeResponse) {
        return;
    }

    if (!navigator.geolocation) {
        showRouteError("Browser ne podržava GPS navigaciju.");

        return;
    }

    if (navigationRuntime.watchId != null) {
        return;
    }

    document.getElementById("startNavigation").classList.add("hidden");

    document.getElementById("stopNavigation").classList.remove("hidden");

    document.getElementById("nextInstruction").classList.remove("hidden");

    setNavigationStatus("NAVIGATING");

    navigationRuntime.watchId = navigator.geolocation.watchPosition(
        async (position) => {
            const { latitude, longitude, heading } = position.coords;

            setCurrentPositionMarker(latitude, longitude, heading);

            updateNextInstruction({
                lat: latitude,

                lon: longitude,
            });

            /*
                             Provera da li je
                             vozilo sišlo sa rute.
                          */

            const offRouteMeters = distanceToRouteMeters(
                {
                    lat: latitude,

                    lon: longitude,
                },

                navigationRuntime.routeCoordinates,
            );

            /*
                             Ako smo više od
                             150 m van rute,
                             izračunaj novu rutu.
      
                             Cooldown = 20 sec.
                          */

            if (
                offRouteMeters > 150 &&
                Date.now() - navigationRuntime.lastRerouteAt > 20000
            ) {
                navigationRuntime.lastRerouteAt = Date.now();

                setWaypoint("start", latitude, longitude, "Trenutna GPS lokacija");

                setNavigationStatus(`REROUTE ${Math.round(offRouteMeters)} m`);

                await calculateNavigationRoute({
                    keepViewport: true,
                });
            }
        },

        (error) => {
            showRouteError(`GPS greška: ${error.message}`);
        },

        {
            enableHighAccuracy: true,

            maximumAge: 2000,

            timeout: 15000,
        },
    );
}

function stopLiveNavigation() {
    if (navigationRuntime.watchId != null) {
        navigator.geolocation.clearWatch(navigationRuntime.watchId);
    }

    navigationRuntime.watchId = null;

    document.getElementById("startNavigation").classList.remove("hidden");

    document.getElementById("stopNavigation").classList.add("hidden");

    document.getElementById("nextInstruction").classList.add("hidden");

    setNavigationStatus("READY");
}

function setCurrentPositionMarker(lat, lon, heading) {
    const map = navigationRuntime.map;

    if (navigationRuntime.positionMarker) {
        map.removeLayer(navigationRuntime.positionMarker);
    }

    const rotation = Number.isFinite(heading) ? heading : 0;

    const icon = L.divIcon({
        className: "",

        html: `

                <div
                    style="
                        width:26px;
                        height:26px;
                        display:grid;
                        place-items:center;
                        border-radius:999px;
                        background:#2563eb;
                        border:3px solid white;
                        box-shadow:0 3px 12px rgba(0,0,0,.4);
                        transform:rotate(${rotation}deg);
                        color:white;
                        font-size:13px">

                    ▲

                </div>
            `,

        iconSize: [26, 26],

        iconAnchor: [13, 13],
    });

    navigationRuntime.positionMarker = L.marker([lat, lon], {
        icon,

        zIndexOffset: 1000,
    }).addTo(map);
}

function updateNextInstruction(position) {
    const maneuvers = navigationRuntime.maneuvers;

    if (!maneuvers.length) {
        return;
    }

    let chosen = maneuvers[0];

    let distance = null;

    if (position) {
        let best = Infinity;

        for (const maneuver of maneuvers) {
            if (!Number.isFinite(maneuver.lat) || !Number.isFinite(maneuver.lon)) {
                continue;
            }

            const d = haversineMeters(
                position,

                {
                    lat: maneuver.lat,

                    lon: maneuver.lon,
                },
            );

            if (d < best) {
                best = d;

                chosen = maneuver;
            }
        }

        distance = best;
    }

    document.getElementById("nextInstructionText").textContent =
        chosen.instruction;

    document.getElementById("nextInstructionDistance").textContent =
        distance == null
            ? formatDistance(chosen.distance)
            : `${formatDistance(distance)} do manevra`;
}

function distanceToRouteMeters(point, route) {
    if (!route?.length) {
        return Infinity;
    }

    let best = Infinity;

    for (let i = 0; i < route.length - 1; i++) {
        best = Math.min(
            best,

            pointToSegmentMeters(
                point,

                route[i],

                route[i + 1],
            ),
        );
    }

    return best;
}

function pointToSegmentMeters(point, a, b) {
    const lat0 = (point.lat * Math.PI) / 180;

    const kx = 111320 * Math.cos(lat0);

    const ky = 110540;

    const ax = (a.lon - point.lon) * kx;

    const ay = (a.lat - point.lat) * ky;

    const bx = (b.lon - point.lon) * kx;

    const by = (b.lat - point.lat) * ky;

    const dx = bx - ax;

    const dy = by - ay;

    const denominator = dx * dx + dy * dy;

    const t =
        denominator === 0
            ? 0
            : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator));

    const x = ax + t * dx;

    const y = ay + t * dy;

    return Math.sqrt(x * x + y * y);
}

function haversineMeters(a, b) {
    const radius = 6371000;

    const p1 = (a.lat * Math.PI) / 180;

    const p2 = (b.lat * Math.PI) / 180;

    const dp = ((b.lat - a.lat) * Math.PI) / 180;

    const dl = ((b.lon - a.lon) * Math.PI) / 180;

    const h =
        Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;

    return 2 * radius * Math.asin(Math.sqrt(h));
}

function uniqueWarnings(items) {
    const seen = new Set();

    return items.filter((item) => {
        const key = item.id || `${item.type}|${item.name}|${item.reason}`;

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
}

function numberValue(id) {
    const value = Number(document.getElementById(id).value);

    return Number.isFinite(value) ? value : 0;
}

function formatDistance(meters) {
    const value = Number(meters || 0);

    return value >= 1000
        ? `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)} km`
        : `${Math.round(value)} m`;
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds || 0)));

    const hours = Math.floor(total / 3600);

    const minutes = Math.round((total % 3600) / 60);

    return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function setNavigationStatus(text) {
    const element = document.getElementById("navStatus");

    if (element) {
        element.textContent = text;
    }
}

function showRouteError(message) {
    const box = document.getElementById("routeError");

    box.textContent = message;

    box.classList.remove("hidden");
}

function hideRouteError() {
    document.getElementById("routeError").classList.add("hidden");
}

function generic() {
    const name = title();
    shell(
        `<div class="card p-6"><div class="text-2xl font-black">${name}</div><p class="muted mt-2 text-sm">Operativni modul je povezan sa tenant API slojem, routing graph-om i live event infrastrukturom.</p><div class="grid md:grid-cols-3 gap-3 mt-6">${kpi("Status", "READY", "module")}${kpi("API", "CONNECTED", "server authority")}${kpi("Security", "TENANT", "company scoped")}</div></div>`,
    );
}

function render() {
    state.page = location.pathname;
    if (state.page.startsWith("/dispatch")) dispatch();
    else if (state.page.startsWith("/navigation")) planner();
    else generic();
}

document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (a && a.origin === location.origin) {
        e.preventDefault();
        history.pushState({}, "", a.pathname);
        render();
    }
});
window.onpopstate = render;
render();
