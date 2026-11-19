const $ = id => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
};
const COL = { Normal: "#1f9d6b", Monitor: "#e0a800", Planned: "#f08c00", High: "#d9480f", Immediate: "#c92a2a" };
const FLOOR = 300, tileX = i => 30 + i * 60;
const TO_UNIT = i => [[tileX(i) + 27, 364], [tileX(i) + 27, 370], [410, 370]];  // tile to energy unit
const TO_BIN = [[560, 378], [560, 395], [700, 395], [700, 246]];                // energy unit to smart bin

let sel = 2, walking = true, paused = false, crowd = 3, pending = 0, flushT = 0, beam = null, tx = null;
let last = performance.now();
const tiles = [], people = [], pulses = [], press = Array(6).fill(0);

// ---------- scene setup ----------
for (let i = 0; i < 6; i++) {
    const x = tileX(i);
    el("polyline", { points: `${x+27},312 ${x+21},318 ${x+33},324 ${x+21},330 ${x+33},336 ${x+27},342`,
        fill: "none", stroke: "#5b6b7a", "stroke-width": 1.5 }, $("under"));
    el("rect", { x: x + 19, y: 342, width: 16, height: 16, rx: 2, fill: "#0f2338" }, $("under"));
    el("line", { x1: x + 27, y1: 358, x2: x + 27, y2: 370, stroke: "#c98a00", "stroke-width": 1.5 }, $("under"));
    tiles[i] = el("rect", { x, y: FLOOR, width: 54, height: 12, rx: 2, fill: "#1f9d6b" }, $("tiles"));
}
el("line", { x1: 57, y1: 370, x2: 410, y2: 370, stroke: "#c98a00", "stroke-width": 1.5 }, $("under"));

function syncPeople() {
    while (people.length < crowd) {
        const g = el("g", {}, $("people"));
        const ln = (x2, y2, y1 = -18) => el("line", { x1: 0, y1, x2, y2, stroke: "#0f2338", "stroke-width": 3, "stroke-linecap": "round" }, g);
        el("circle", { cx: 0, cy: -46, r: 6, fill: "#0f2338" }, g);
        ln(0, -20, -40);
        people.push({ g, x: -20 - people.length * 140, ph: Math.random() * 6, a: ln(0, 0), b: ln(0, 0) });
    }
    while (people.length > crowd) people.pop().g.remove();
}

// ---------- animation helpers ----------
function spawn(pts, color) {
    if (pulses.length < 60) pulses.push({ pts, d: 0, c: el("circle", { r: 4, fill: color }, $("pulses")) });
}
function along(pts, d) {
    for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], L = Math.hypot(x1 - x0, y1 - y0);
        if (d <= L) return [x0 + (x1 - x0) * d / L, y0 + (y1 - y0) * d / L];
        d -= L;
    }
    return null;
}
function step(i) { pending++; press[i] = 1; spawn(TO_UNIT(i), "#22b8cf"); }
const surface = () => 360 - SW.get().bins[sel].fill * 1.5;

function toast(msg, warn) {
    const t = $("toast");
    t.textContent = msg; t.className = warn ? "warn on" : "on";
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.className = ""; }, 3500);
}

function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!paused) {
        people.forEach(p => {
            if (walking) {
                p.x += 60 * dt; if (p.x > 450) p.x = -30;
                const before = Math.floor(p.ph / Math.PI); p.ph += 6 * dt;
                if (Math.floor(p.ph / Math.PI) !== before && p.x >= 30 && p.x <= 384) step(Math.floor((p.x - 30) / 60));
            }
            const s = Math.sin(p.ph) * 10;
            p.a.setAttribute("x2", s); p.b.setAttribute("x2", -s);
            p.g.setAttribute("transform", `translate(${p.x} ${FLOOR})`);
        });
        flushT += dt;
        if (flushT > 0.3 && pending) { SW.addSteps(pending); pending = 0; flushT = 0; render(); }

        tiles.forEach((t, i) => {
            press[i] = Math.max(0, press[i] - dt * 4);
            t.setAttribute("transform", `translate(0 ${4 * press[i]})`);
            t.setAttribute("fill", press[i] > 0.3 ? "#7ee0b3" : "#1f9d6b");
        });
        for (let k = pulses.length - 1; k >= 0; k--) {
            const p = pulses[k], pos = along(p.pts, p.d += 200 * dt);
            if (!pos) { p.c.remove(); pulses.splice(k, 1); }
            else { p.c.setAttribute("cx", pos[0]); p.c.setAttribute("cy", pos[1]); }
        }
        if (beam) {
            beam.t += dt / 0.9;
            const k = Math.max(0, beam.t < 0.5 ? beam.t * 2 : (1 - beam.t) * 2);
            $("ping").setAttribute("cy", 212 + (surface() - 212) * k);
            $("ping").setAttribute("opacity", 1);
            if (beam.t >= 1) { $("ping").setAttribute("opacity", 0); toast(beam.msg); beam = null; }
        }
        if (tx) {
            tx.t += dt / 1.1;
            $("packet").setAttribute("cx", 740 + 60 * Math.min(1, tx.t));
            $("packet").setAttribute("opacity", 1);
            $("waves").setAttribute("opacity", Math.abs(Math.sin(tx.t * 9)) * 0.9);
            if (tx.t >= 1) {
                $("packet").setAttribute("opacity", 0); $("waves").setAttribute("opacity", 0);
                toast(tx.msg); tx = null; render();
            }
        }
    }
    requestAnimationFrame(frame);
}

// ---------- readouts (everything comes from the shared state) ----------
function render() {
    const s = SW.get(), C = SW.CFG, b = s.bins[sel], st = SW.status(b.fill);
    const pct = s.storedWh / C.CAP_WH * 100, wh = v => v.toFixed(6) + " Wh";
    const set = (id, v) => { $(id).textContent = v; };
    set("steps", s.steps.toLocaleString()); set("raw", s.rawJ.toFixed(3) + " J");
    set("usable", wh(s.usableWh)); set("stored", `${wh(s.storedWh)} (${pct.toFixed(1)}% of ${C.CAP_WH} Wh)`);
    set("used", wh(s.consumedWh)); set("over", wh(s.overflowWh)); set("advice", SW.advice(s));
    set("binInfo", `${b.id}, ${b.location}`); set("fillInfo", `${b.fill}% (${st})`);
    set("dist", (C.BIN_H * (1 - b.fill / 100)).toFixed(1) + " cm");
    set("meas", b.measured ? `${b.measured.cm} cm at ${new Date(b.measured.t).toLocaleTimeString()}` : "None yet");
    set("sent", b.sent ? new Date(b.sent).toLocaleTimeString() : "Not sent");
    $("json").textContent = s.packet ? JSON.stringify(s.packet, null, 2) : "No packet yet.";
    if (!tx) set("mon", s.packet ? `${s.packet.bin_id}: ${s.packet.fill_level_percent}%` : "Waiting for data");

    $("cap").setAttribute("width", Math.min(100, pct) * 1.3);
    $("waste").setAttribute("y", 360 - b.fill * 1.5); $("waste").setAttribute("height", b.fill * 1.5);
    $("beam").setAttribute("y2", 360 - b.fill * 1.5);
    $("led").setAttribute("fill", COL[st]);
    set("binLabel", `3. Smart bin: ${b.id} ${b.location}`);
    if (document.activeElement !== $("fill")) $("fill").value = b.fill;

    $("binList").innerHTML = s.bins.map((x, i) => `
        <div class="binrow ${i === sel ? "sel" : ""}" data-bin="${i}">
            <span>${x.id} ${x.location}</span>
            <span class="bar"><i style="width:${x.fill}%;background:${COL[SW.status(x.fill)]}"></i></span>
            <b>${x.fill}%</b>
        </div>`).join("");
    $("plan").innerHTML = SW.plan(s).map(x => `
        <li>${x.id} ${x.location}: ${x.fill}%, ${SW.status(x.fill)},
            ${x.fill >= 100 ? "already full" : x.hrs.toFixed(1) + " h until full"}
            <button data-collect="${x.i}">Mark collected</button></li>`).join("");
}

// ---------- controls ----------
const A = {
    walk() { walking = !walking; $("walkBtn").textContent = walking ? "Pause walking" : "Start walking"; },
    more() { crowd = Math.min(6, crowd + 1); syncPeople(); },
    less() { crowd = Math.max(1, crowd - 1); syncPeople(); },
    steps() {
        const n = Math.min(100000, Math.floor(Number($("n").value)));
        if (!(n > 0)) return toast("Enter a number of footsteps above 0.", true);
        SW.addSteps(n); press.fill(1);
        for (let k = 0; k < Math.min(n, 12); k++) spawn(TO_UNIT(k % 6), "#22b8cf");
    },
    resetSteps() { SW.act(s => { s.steps = 0; s.rawJ = 0; s.usableWh = 0; }); },
    resetEnergy() { SW.act(s => { s.storedWh = 0; s.consumedWh = 0; s.overflowWh = 0; }); },
    add() { SW.addWaste(sel, 5); },
    remove() { SW.addWaste(sel, -5); },
    empty() { SW.setFill(sel, 0); },
    measure() {
        if (beam || tx) return;
        const r = SW.measure(sel);
        if (!r.ok) return toast(r.msg, true);
        spawn(TO_BIN, "#f08c00");
        beam = { t: 0, msg: `Measured ${r.cm} cm, so the fill level is ${r.fill}%.` };
    },
    send() {
        if (beam || tx) return;
        const r = SW.transmit(sel);
        if (!r.ok) return toast(r.msg, true);
        spawn(TO_BIN, "#f08c00");
        tx = { t: 0, msg: r.msg };
    },
    pause() { paused = !paused; $("pauseBtn").textContent = paused ? "Resume simulation" : "Pause simulation"; },
    reset() { SW.reset(); pulses.splice(0).forEach(p => p.c.remove()); beam = tx = null; pending = 0; }
};

document.addEventListener("click", e => {
    const a = e.target.closest("[data-act]"), c = e.target.closest("[data-bin]"), k = e.target.closest("[data-collect]");
    if (k) { SW.setFill(Number(k.dataset.collect), 0); toast("Marked as collected: fill level reset to 0%."); }
    else if (c) sel = Number(c.dataset.bin);
    else if (a) A[a.dataset.act]();
    render();
});
$("fill").addEventListener("input", e => { SW.setFill(sel, Number(e.target.value)); render(); });

SW.subscribe(render);   // the website changed something: refresh
syncPeople();
render();
requestAnimationFrame(frame);
