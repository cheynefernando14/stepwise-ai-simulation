// Load AFTER shared.js and sim.js. Keeps the website's variables and the shared state in step.
(function () {
    const idx = () => Number(document.getElementById("binSelect").value);

    function pull(s) {                       // simulation changed something: update the website
        totalSteps = s.steps; totalEnergy = s.usableWh; storedEnergy = s.storedWh;
        energyConsumed = s.consumedWh; energyOverflow = s.overflowWh;
        s.bins.forEach((b, i) => { bins[i].fill = b.fill; });
        updateDashboard(); runAnalysis();
    }
    function push() {                        // website changed something: update the shared state
        SW.act(s => {
            s.steps = totalSteps; s.usableWh = totalEnergy; s.rawJ = totalSteps * SW.CFG.EPS_MJ / 1000;
            s.storedWh = storedEnergy; s.consumedWh = energyConsumed; s.overflowWh = energyOverflow;
            bins.forEach((b, i) => { s.bins[i].fill = b.fill; });
        });
    }

    ["generateEnergy", "addWaste", "emptyBin"].forEach(name => {
        const original = window[name];
        window[name] = function () { original.apply(this, arguments); push(); };
    });

    const sendOriginal = window.transmitData;
    window.transmitData = function () {
        const before = energyConsumed;
        sendOriginal();
        if (energyConsumed > before) {       // transmission succeeded in the website: record the packet too
            push();
            SW.act(s => { const i = idx(); SW.stamp(s, i); s.bins[i].sent = Date.now(); s.packet = SW.packet(s, i); });
        }
    };

    SW.subscribe(pull);
    pull(SW.get());
})();
