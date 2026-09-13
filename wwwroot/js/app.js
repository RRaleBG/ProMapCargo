(() => {
    "use strict";

    function initializeTheme() {
        const root = document.documentElement;

        let theme = null;

        try {
            theme = localStorage.getItem("pm-theme");
        } catch {
            theme = null;
        }

        if (theme !== "emerald" && theme !== "white") {
            theme = "emerald";
        }

        root.dataset.theme = theme;
    }

    window.ProMapCargo = window.ProMapCargo || {};

    window.ProMapCargo.theme = {
        get() {
            return document.documentElement.dataset.theme || "emerald";
        },

        set(theme) {
            if (theme !== "emerald" && theme !== "white") {
                return;
            }

            document.documentElement.dataset.theme = theme;

            try {
                localStorage.setItem("pm-theme", theme);
            } catch {
            }
        },

        toggle() {
            this.set(this.get() === "emerald" ? "white" : "emerald");
        }
    };

    document.addEventListener("DOMContentLoaded", () => {
        initializeTheme();
    });
})();