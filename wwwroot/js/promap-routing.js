"use strict";

window.ProMap = window.ProMap || {};
window.ProMap.Routing = (() => {
    const DEFAULT_ENDPOINT = "/api/routing/route";

    function normalizeCoordinate(point) {
        if (!point) {
            return null;
        }
        return {
            latitude: Number(point.latitude),
            longitude: Number(point.longitude)
        };
    }


    function validateCoordinate(point) {
        if (!point) {
            return false;
        }
        return Number.isFinite(point.latitude) &&
            Number.isFinite(point.longitude) &&
            point.latitude >= -90 &&
            point.latitude <= 90 &&
            point.longitude >= -180 &&
            point.longitude <= 180;
    }


    function buildRequest(state) {
        const start = normalizeCoordinate(state.start);
        const destination = normalizeCoordinate(state.destination);
        if (!validateCoordinate(start)) {
            throw new Error("START_INVALID");
        }
        if (!validateCoordinate(destination)) {
            throw new Error("DESTINATION_INVALID");
        }
        return {
            start,
            destination,
            vehicle: {
                heightMeters: Number(state.vehicle.heightMeters),
                widthMeters: Number(state.vehicle.widthMeters),
                lengthMeters: Number(state.vehicle.lengthMeters),
                weightTons: Number(state.vehicle.weightTons)
            },
            options: {
                avoidTolls: Boolean(state.options.avoidTolls),
                avoidFerries: Boolean(state.options.avoidFerries),
                avoidLowClearance: Boolean(
                    state.options.avoidLowClearance
                )
            }
        };
    }


    async function calculate(state, options = {}) {
        const endpoint = options.endpoint || DEFAULT_ENDPOINT;
        const request = buildRequest(state);
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(request)
        });

        let payload = null;
        try {
            payload = await response.json();
        }
        catch {
            payload = null;
        }
        if (!response.ok) {
            const error = new Error(
                payload?.message ||
                `Routing request failed (${response.status}).`
            );
            error.code = payload?.code || `HTTP_${response.status}`;
            error.payload = payload;
            throw error;
        }

        if (!payload) {
            throw new Error("EMPTY_ROUTING_RESPONSE");
        }

        if (payload.success === false) {
            const error = new Error(
                payload.message ||
                "Routing failed."
            );
            error.code = payload.code || "ROUTING_FAILED";
            error.payload = payload;
            throw error;
        }
        return payload;
    }


    return {
        calculate,
        buildRequest,
        validateCoordinate
    };

})();