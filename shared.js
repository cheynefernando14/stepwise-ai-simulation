// Shared StepWise AI data layer. Both simulation.html and index.html read and write this one state.
// Storage is localStorage (same site), with BroadcastChannel and storage events to sync open tabs.
const SW = (() => {
    const KEY = "stepwise_state_v1";
    const CFG = { EPS_MJ: 5, EFF: 0.7, CAP_WH: 0.02, SENSOR_WH: 0.00035, TX_WH: 0.00015, BIN_H: 100 };
    const NEED = CFG.SENSOR_WH + CFG.TX_WH;
    const NO_ENERGY = "Insufficient stored energy. Sensor operation cannot be completed.";
    const fresh = () => ({
        steps: 0, rawJ: 0, usableWh: 0, storedWh: 0, consumedWh: 0, overflowWh: 0, packet: null,
        bins: [["Main Entrance", 32, 9], ["Library", 68, 6], ["Cafeteria", 88, 18], ["Lecture Hall", 48, 8]]
            .map(([location, fill, rate], i) =>
                ({ id: "BIN-0" + (i + 1), name: "Bin 0" + (i + 1), location, fill, rate, measured: null, sent: null }))
    });
    const subs = [];
    const bc = "BroadcastChannel" in window ? new BroadcastChannel("stepwise") : null;
    let state;

    function load() {
        try { const s = JSON.parse(localStorage.getItem(KEY)); state = s && s.bins ? s : fresh(); }
        catch (e) { state = fresh(); }
        return state;
    }
    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
        if (bc) bc.postMessage(1);
    }
    function external() { load(); subs.forEach(f => f(state)); }
    if (bc) bc.onmessage = external;
    window.addEventListener("storage", e => { if (e.key === KEY) external(); });

    // Every change loads the latest state first, so two open pages never overwrite each other with stale data.
    const act = fn => { load(); const r = fn(state); save(); return r; };
    const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
    const status = f => f >= 100 ? "Immediate" : f >= 85 ? "High" : f >= 75 ? "Planned" : f >= 60 ? "Monitor" : "Normal";

    const stamp = (s, i) => {
        const b = s.bins[i];
        b.measured = { cm: +(CFG.BIN_H * (1 - b.fill / 100)).toFixed(1), fill: b.fill, t: Date.now() };
    };
    const packet = (s, i) => {
        const b = s.bins[i], m = b.measured;
        return { bin_id: b.id, location: b.location, sensor_distance_cm: m.cm, fill_level_percent: m.fill,
                 status: status(m.fill), energy_status: s.storedWh >= NEED ? "Sufficient" : "Low" };
    };
    const spend = (s, wh) => { if (s.storedWh < wh) return false; s.storedWh -= wh; s.consumedWh += wh; return true; };

    return {
        CFG, NEED, status, stamp, packet, act, get: () => state, load, subscribe: f => subs.push(f),
        addSteps: n => act(s => {
            const raw = n * CFG.EPS_MJ / 1000;              // J
            const wh = raw * CFG.EFF / 3600;                // usable Wh
            const kept = Math.max(0, Math.min(wh, CFG.CAP_WH - s.storedWh));
            s.steps += n; s.rawJ += raw; s.usableWh += wh; s.storedWh += kept; s.overflowWh += wh - kept;
        }),
        measure: i => act(s => {
            if (!spend(s, CFG.SENSOR_WH)) return { ok: false, msg: NO_ENERGY };
            stamp(s, i); return { ok: true, cm: s.bins[i].measured.cm, fill: s.bins[i].measured.fill };
        }),
        transmit: i => act(s => {
            if (!s.bins[i].measured) return { ok: false, msg: "Measure the fill level first." };
            if (!spend(s, CFG.TX_WH)) return { ok: false, msg: NO_ENERGY };
            s.bins[i].sent = Date.now(); s.packet = packet(s, i);
            return { ok: true, msg: "Bin data successfully transmitted." };
        }),
        setFill: (i, v) => act(s => { s.bins[i].fill = clamp(v); }),
        addWaste: (i, d) => act(s => { s.bins[i].fill = clamp(s.bins[i].fill + d); }),
        reset: () => { state = fresh(); save(); },
        plan: s => s.bins.map((b, i) => ({
            ...b, i, hrs: b.fill >= 100 ? 0 : (100 - b.fill) / b.rate * 24,
            p: b.fill >= 100 ? 0 : b.fill >= 85 ? 1 : b.fill >= 75 ? 2 : b.fill >= 60 ? 3 : 4
        })).sort((a, b) => a.p - b.p || a.hrs - b.hrs),
        advice: s => s.storedWh >= NEED * 3 ? "Sufficient energy: proceed with monitoring and data transmission."
            : s.storedWh >= NEED ? "Low energy: prioritize essential monitoring."
            : "Insufficient energy: delay non-essential operations until more steps are recorded."
    };
})();
SW.load();
