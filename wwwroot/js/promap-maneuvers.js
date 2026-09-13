"use strict";

window.ProMap = window.ProMap || {};
window.ProMap.Maneuvers = (() => {

    function normalize(maneuver) {
        if (!maneuver) {

            return {
                type: "continue",
                icon: "↑",
                instruction: "Nastavi pravo",
                distanceMeters: null
            };
        }

        return {
            type: maneuver.type ||  "continue",
            modifier: maneuver.modifier || null,
            icon: getIcon(
                    maneuver.type,
                    maneuver.modifier
                ),
            instruction:
                maneuver.instruction ||
                buildInstruction(
                    maneuver.type,
                    maneuver.modifier
                ),
            distanceMeters:
                Number.isFinite(Number(maneuver.distanceMeters)) ? Number(maneuver.distanceMeters) : null
        };
    }

    function getIcon(type, modifier) {
        switch (type) {
            case "turn":

                if (modifier === "left") {
                    return "↰";
                }
                if (modifier === "right") {
                    return "↱";
                }
                return "↪";

            case "roundabout":
                return "⟳";
            case "uturn":
                return "↶";
            case "merge":
                return "⇢";
            case "fork":
                return "⑂";
            case "arrive":
                return "●";
            case "depart":
                return "↑";
            default:
                return "↑";
        }
    }

    function buildInstruction(type, modifier) {
        if (type === "turn") {

            if (modifier === "left") {
                return "Skreni levo";
            }
            if (modifier === "right") {
                return "Skreni desno";
            }
            return "Skretanje";
        }
        if (type === "roundabout") {
            return "Uđi u kružni tok";
        }
        if (type === "uturn") {
            return "Polukružno okretanje";
        }
        if (type === "arrive") {
            return "Stigli ste na odredište";
        }
        return "Nastavi pravo";
    }

    function formatDistance(meters) {
        if (!Number.isFinite(meters)) {
            return "—";
        }
        if (meters < 1000) {
            return `${Math.round(meters)} m`;
        }
        return `${(meters / 1000).toFixed(1)} km`;
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(seconds)) {
            return "—";
        }
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) {
            return `${minutes} min`;
        }

        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        return `${hours} h ${remainder} min`;
    }

    return {
        normalize,
        formatDistance,
        formatDuration
    };

})();