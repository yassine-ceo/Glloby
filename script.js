// ── FIREBASE CONFIG (replace with your real values) ──
const FB = {
    apiKey: "AIzaSyCgRJmHZYHJHOAQ-JYEnDxCZxgVT73SIaw",
    authDomain: "glloby.firebaseapp.com",
    projectId: "glloby",
    storageBucket: "glloby.firebasestorage.app",
    messagingSenderId: "727458984998",
    appId: "1:727458984998:web:e0a2d207c4d5a920aa2e7b"
};
const CLOUD_NAME   = "dm0zoqxkh";
const UPLOAD_PRESET = "glloby_unsigned";
const CLOUD_URL    = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

// Initialize Firebase (Compat SDK)
firebase.initializeApp(FB);
const auth = firebase.auth();
const db   = firebase.firestore();
const rtdb = firebase.database();

// ── CITY COORDS ──
const CITY_COORDS = {
    "Casablanca":[33.5731,-7.5898],"Rabat":[34.0209,-6.8416],"Salé":[34.0372,-6.8132],
    "Marrakech":[31.6295,-7.9811],"Tangier":[35.7595,-5.834],"Fes":[34.0181,-5.0078],
    "Agadir":[30.4278,-9.5981],"Meknes":[33.8935,-5.5473],"Oujda":[34.6867,-1.9114],
    "Kenitra":[34.261,-6.5802],"Tetouan":[35.5785,-5.3684],"El Jadida":[33.2549,-8.5083],
    "Safi":[32.3008,-9.2274],"Mohammedia":[33.6861,-7.3833],"Khouribga":[32.8811,-6.9063],
    "Beni Mellal":[32.3373,-6.3498],"Nador":[35.1681,-2.9287],"Settat":[33.001,-7.6197],
    "Larache":[35.1932,-6.1561],"Chefchaouen":[35.1688,-5.2636],"Essaouira":[31.5125,-9.77],
    "Ouarzazate":[30.9335,-6.9371],"Dakhla":[23.7136,-15.9355],"Laayoune":[27.1536,-13.2033],
    "Guelmim":[28.9863,-10.0572],"Tiznit":[29.7,-9.7333],"Errachidia":[31.9314,-4.4244],
    "Taza":[34.2133,-4.0097],"Khemisset":[33.8239,-6.0661],"Taroudant":[30.4727,-8.877]
};

// ── STATE ──
let currentUser = null;
let cityId = "Rabat";
let map = null, myMarker = null;
const markers = {};
let chatUnsub = null, usersUnsub = null, inboxUnsub = null;
let selectedPfpFile = null;

// ── DOM SHORTCUT ──
const $ = id => document.getElementById(id);

// ── MODAL HELPERS (no DOM refs at parse time) ──
function openModal(id)  { const m = $(id); if (m) m.classList.add("active"); }
function closeModal(id) { const m = $(id); if (m) m.classList.remove("active"); }
function setAuthStep(stepId) {
    document.querySelectorAll(".auth-step").forEach(s => s.classList.remove("active"));
    const t = $(stepId); if (t) t.classList.add("active");
}

// ── ROUTING ──
const VIEWS = ["map","messages","inbox","profile"];
function showView(name) {
    VIEWS.forEach(v => {
        const el = $(`view-${v}`);
        if (el) el.classList.toggle("active", v === name);
    });
    document.querySelectorAll(".nav-btn[data-view]").forEach(b =>
        b.classList.toggle("active", b.dataset.view === name));
    if (name === "map" && map) setTimeout(() => map.invalidateSize(), 80);
    history.pushState({}, "", `/${name === "map" ? "" : name}`);
}
function handleRoute() {
    const p = location.pathname.replace(/^\//,"") || "map";
    showView(VIEWS.includes(p) ? p : "map");
}
window.addEventListener("popstate", handleRoute);

// ── AUTH FLOW (registered after DOM ready) ──
auth.onAuthStateChanged(async user => {
    if (!user) {
        openModal("auth-modal");
        setAuthStep("auth-step-login");
        stopApp();
        return;
    }
    if (!user.emailVerified && !user.isAnonymous) {
        openModal("auth-modal");
        setAuthStep("auth-step-verify");
        return;
    }
    try {
        const snap = await db.collection("users").doc(user.uid).get();
        if (!snap.exists || !snap.data().name) {
            openModal("auth-modal");
            setAuthStep("auth-step-setup");
            return;
        }
        currentUser = snap.data();
        cityId = currentUser.city || "Rabat";
        closeModal("auth-modal");
        updateProfileUI();
        startApp();
    } catch(e) {
        console.error("[Auth] Profile load error:", e);
        openModal("auth-modal");
        setAuthStep("auth-step-setup");
    }
});

// ═══════════════════════════════════════════
// ALL DOM WIRING — runs after HTML is parsed
// ═══════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {

    // Nav buttons
    document.querySelectorAll(".nav-btn[data-view]").forEach(btn =>
        btn.addEventListener("click", e => { e.preventDefault(); showView(btn.dataset.view); }));

    // Premium gate
    document.querySelectorAll(".premium-gate").forEach(el =>
        el.addEventListener("click", e => { e.preventDefault(); openModal("premium-modal"); }));
    on("close-premium", "click", () => closeModal("premium-modal"));
    on("close-popup",   "click", () => closeModal("user-profile-popup"));

    // ── Login ──
    on("btn-login", "click", async () => {
        const email = val("auth-email");
        const pw    = val("auth-password");
        if (!email || !pw) return setErr("auth-error", "Enter email and password.");
        setErr("auth-error", "");
        setBtnText("btn-login", "Signing in…", true);
        try {
            await auth.signInWithEmailAndPassword(email, pw);
        } catch(e) {
            setErr("auth-error", friendlyError(e));
        } finally {
            setBtnText("btn-login", "Sign In", false);
        }
    });

    // ── Register ──
    on("btn-register", "click", async () => {
        const email = val("auth-email");
        const pw    = val("auth-password");
        if (!email || !pw) return setErr("auth-error", "Enter email and password.");
        setErr("auth-error", "");
        setBtnText("btn-register", "Creating…", true);
        try {
            const cred = await auth.createUserWithEmailAndPassword(email, pw);
            await cred.user.sendEmailVerification();
            const msgEl = $("verify-email-msg");
            if (msgEl) msgEl.textContent = `Verification link sent to ${email}`;
            setAuthStep("auth-step-verify");
        } catch(e) {
            setErr("auth-error", friendlyError(e));
        } finally {
            setBtnText("btn-register", "Create Account", false);
        }
    });

    // ── Anonymous ──
    on("btn-anon", "click", async () => {
        setErr("auth-error", "");
        setBtnText("btn-anon", "Connecting…", true);
        try {
            await auth.signInAnonymously();
        } catch(e) {
            setErr("auth-error", friendlyError(e));
            setBtnText("btn-anon", "Browse Anonymously", false);
        }
    });

    // ── Verify step ──
    on("btn-check-verify", "click", async () => {
        try {
            await auth.currentUser?.reload();
            if (auth.currentUser?.emailVerified) {
                setAuthStep("auth-step-setup");
            } else {
                setErr("verify-error", "Not verified yet. Check your inbox.");
            }
        } catch(e) { setErr("verify-error", e.message); }
    });
    on("btn-resend-verify", "click", async () => {
        try {
            await auth.currentUser?.sendEmailVerification();
            setErr("verify-error", "Email resent!");
        } catch(e) { setErr("verify-error", e.message); }
    });

    // ── Profile photo preview ──
    on("setup-pfp-input", "change", e => {
        const f = e.target.files[0];
        if (!f) return;
        selectedPfpFile = f;
        const img = $("setup-avatar-img");
        if (img) img.src = URL.createObjectURL(f);
        setErr("pfp-status", "✓ Photo selected");
    });
    on("setup-name", "input", () => {
        const n = val("setup-name");
        const img = $("setup-avatar-img");
        if (n && img) img.src =
            `https://ui-avatars.com/api/?name=${encodeURIComponent(n)}&background=3b82f6&color=fff&size=200`;
    });

    // ── Complete setup ──
    on("btn-complete-setup", "click", async () => {
        const name     = val("setup-name");
        const username = val("setup-username").replace(/\s/g, "");
        const age      = parseInt($("setup-age")?.value || "0");
        const gender   = $("setup-gender")?.value || "";
        const city     = $("setup-city")?.value || "";
        const country  = val("setup-country") || "Morocco";
        const btn      = $("btn-complete-setup");

        if (!name || !username || !age || !gender || !city)
            return setErr("setup-error", "Please fill all fields.");
        if (!selectedPfpFile && !auth.currentUser?.isAnonymous)
            return setErr("setup-error", "Profile photo is required.");

        setErr("setup-error", "");
        if (btn) { btn.disabled = true; btn.innerHTML = "<span>Uploading…</span>"; }

        try {
            let photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff&size=200`;
            if (selectedPfpFile) {
                const fd = new FormData();
                fd.append("file", selectedPfpFile);
                fd.append("upload_preset", UPLOAD_PRESET);
                fd.append("public_id", `profiles/${auth.currentUser.uid}_${Date.now()}`);
                const res  = await fetch(CLOUD_URL, { method: "POST", body: fd });
                const data = await res.json();
                if (data.secure_url) photoUrl = data.secure_url;
                else throw new Error("Cloudinary upload failed.");
            }
            const uid = auth.currentUser.uid;
            const profile = {
                uid, email: auth.currentUser.email || "",
                name, username, age, gender, city, country,
                avatarSeed: "user_init",
                profilePhotoUrl: photoUrl,
                isAnonymous: auth.currentUser.isAnonymous,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                friends: [], is_sharing_location: false,
                is_online: true, lastSeen: firebase.firestore.FieldValue.serverTimestamp()
            };
            await db.collection("users").doc(uid).set(profile, { merge: true });
            currentUser = profile;
            cityId = city;
            closeModal("auth-modal");
            updateProfileUI();
            startApp();
        } catch (e) {
            setErr("setup-error", e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = "<span>Go Live on Map</span><i class='bx bx-right-arrow-alt'></i>"; }
        }
    }); // end btn-complete-setup

    // ── Logout ──
    on("logout-btn", "click", async () => {
        if (auth.currentUser) {
            await db.collection("users").doc(auth.currentUser.uid).update({ 
                is_sharing_location: false, 
                is_online: false, 
                lastSeen: firebase.firestore.FieldValue.serverTimestamp() 
            }).catch(()=>{});
        }
        await auth.signOut();
    }); // end logout

    // ── Chat send ──
    on("chat-send", "click", sendChatMsg);
    const chatInput = $("chat-input");
    if (chatInput) chatInput.addEventListener("keypress", e => e.key === "Enter" && sendChatMsg());

    // ── Popup chat button ──
    on("popup-chat-btn", "click", () => {
        if (!popupTargetUid) return;
        closeModal("user-profile-popup");
        openInboxConvo(popupTargetUid);
    });

    // ── Map FAB: random chat (premium) ──
    on("fab-chat", "click", () => openModal("premium-modal"));

    // Init route on first load
    handleRoute();

}); // end DOMContentLoaded

// ── PROFILE UI ──
function updateProfileUI() {
    if (!currentUser) return;
    $("profile-avatar").src    = currentUser.profilePhotoUrl || "";
    $("profile-name").textContent     = currentUser.name || "—";
    $("profile-username").textContent = "@" + (currentUser.username || "—");
    $("profile-city-tag").innerHTML   = `<i class='bx bx-map'></i> ${currentUser.city || "—"}`;
    $("profile-gender").textContent   = currentUser.gender || "—";
    $("profile-age").textContent      = currentUser.age || "—";
    $("profile-country").textContent  = currentUser.country || "—";
    $("chat-city-label").innerHTML    = `<i class='bx bx-map-alt'></i> ${currentUser.city || "City"} Chat`;
}

// ── STARTUP / TEARDOWN ──
function startApp() {
    initMap();
    initChat();
    initInbox();
    setupPresence();
}

// ── Helper: attach event listener safely ──
function on(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    else console.warn(`[Glloby] Element #${id} not found for '${event}' listener.`);
}
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ""; }
function setBtnText(id, text, disabled) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.disabled = disabled;
}

function stopApp() {
    if (chatUnsub) { chatUnsub(); chatUnsub = null; }
    if (usersUnsub) { usersUnsub(); usersUnsub = null; }
    if (inboxUnsub) { inboxUnsub(); inboxUnsub = null; }
}

// ── PRESENCE (Firebase RTDB) ──
function setupPresence() {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const statusRef = rtdb.ref(`status/${uid}`);
    const connRef   = rtdb.ref(".info/connected");
    connRef.on("value", snap => {
        if (!snap.val()) return;
        statusRef.set({ status:"online", last_online: null });
        statusRef.onDisconnect().set({ status:"offline", last_online: firebase.database.ServerValue.TIMESTAMP });
    });
}

// ── MAP ──
async function initMap() {
    if (map) return;
    map = L.map("map", { zoomControl:false, attributionControl:false })
            .setView([31.7917,-7.0926], 6);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
        { maxZoom:19, subdomains:"abcd" }).addTo(map);

    // City labels layer
    Object.entries(CITY_COORDS).forEach(([name,[lat,lng]]) => {
        L.marker([lat,lng], { icon: L.divIcon({
            className:"", iconSize:[1,1],
            html:`<span style="color:rgba(255,255,255,.7);font-size:10px;font-weight:900;letter-spacing:1.5px;white-space:nowrap;text-shadow:0 0 6px #000;">${name.toUpperCase()}</span>`
        })}).addTo(map);
    });

    const coords = await getLocation();
    map.flyTo(coords, 13, { animate:true, duration:2 });
    syncMyLocation(coords);
    listenToUsers();

    // FABs
    $("fab-gps").addEventListener("click", async () => {
        const c = await getLocation();
        map.flyTo(c, 14, { animate:true, duration:1 });
        syncMyLocation(c);
    });
    $("fab-reset").addEventListener("click", () =>
        map.flyTo(CITY_COORDS[cityId] || [34.0209,-6.8416], 13, { animate:true }));

    // City search
    const searchInput = $("city-search-input");
    const results = $("search-results");
    searchInput.addEventListener("input", () => {
        const q = searchInput.value.trim().toLowerCase();
        results.innerHTML = "";
        if (!q) { results.style.display="none"; return; }
        const hits = Object.keys(CITY_COORDS).filter(c => c.toLowerCase().includes(q)).slice(0,8);
        if (!hits.length) { results.style.display="none"; return; }
        hits.forEach(city => {
            const li = document.createElement("li");
            li.innerHTML = `<i class='bx bx-map'></i>${city}`;
            li.addEventListener("click", () => {
                map.flyTo(CITY_COORDS[city], 14, { animate:true, duration:1.5 });
                searchInput.value = "";
                results.style.display="none";
            });
            results.appendChild(li);
        });
        results.style.display="block";
    });
    $("clear-search-btn").addEventListener("click", () => {
        searchInput.value=""; results.style.display="none";
    });

    // Map click → city chat
    map.on("click", e => {
        const { lat, lng } = e.latlng;
        let nearest = null, minDist = 8000;
        Object.entries(CITY_COORDS).forEach(([name,[clat,clng]]) => {
            const d = map.distance([lat,lng],[clat,clng]);
            if (d < minDist) { minDist=d; nearest=name; }
        });
        if (nearest) { cityId=nearest; showView("messages"); initChat(); }
    });
}

async function getLocation() {
    return new Promise(res => {
        navigator.geolocation?.getCurrentPosition(
            p => res([p.coords.latitude, p.coords.longitude]),
            async () => res(await ipFallback()),
            { timeout:7000, enableHighAccuracy:true }
        ) || ipFallback().then(res);
    });
}
async function ipFallback() {
    try {
        const r = await fetch("https://ip-api.com/json/");
        const d = await r.json();
        if (d.status==="success") return [d.lat, d.lon];
    } catch {}
    return [34.0209,-6.8416]; // Rabat fallback
}

async function syncMyLocation([lat,lng]) {
    if (!auth.currentUser || !currentUser) return;
    const uid = auth.currentUser.uid;
    const icon = L.divIcon({
        className:"g-marker", iconSize:[42,42], iconAnchor:[21,21],
        html:`<div class="g-marker-ring"></div><div class="g-marker-avatar" style="background-image:url('${currentUser.profilePhotoUrl||""}')"></div>`
    });
    if (!myMarker) {
        myMarker = L.marker([lat,lng],{icon}).addTo(map);
    } else { myMarker.setLatLng([lat,lng]); myMarker.setIcon(icon); }
    await db.collection("users").doc(uid).update({
        location:{ latitude:lat, longitude:lng, timestamp: firebase.firestore.FieldValue.serverTimestamp() },
        is_sharing_location:true
    }).catch(()=>{});
}

function listenToUsers() {
    usersUnsub = db.collection("users").where("is_sharing_location","==",true).limit(200).onSnapshot(snap => {
        snap.docChanges().forEach(change => {
            const uid  = change.doc.id;
            const data = change.doc.data();
            if (uid === auth.currentUser?.uid) return; // skip self
            if (change.type==="removed" || !data.is_sharing_location) {
                if (markers[uid]) { map.removeLayer(markers[uid]); delete markers[uid]; }
                return;
            }
            const loc = data.location;
            if (!loc?.latitude) return;
            const icon = L.divIcon({
                className:"g-marker", iconSize:[38,38], iconAnchor:[19,19],
                html:`<div class="g-marker-avatar" style="background-image:url('${data.profilePhotoUrl||""}')"></div>`
            });
            if (!markers[uid]) {
                markers[uid] = L.marker([loc.latitude,loc.longitude],{icon})
                    .addTo(map)
                    .on("click", () => showUserPopup(uid, data));
            } else {
                markers[uid].setLatLng([loc.latitude,loc.longitude]);
                markers[uid].setIcon(icon);
            }
        });
    });
}

// ── USER PROFILE POPUP ──
let popupTargetUid = null;
function showUserPopup(uid, data) {
    popupTargetUid = uid;
    $("popup-avatar").src         = data.profilePhotoUrl || "";
    $("popup-name").textContent   = data.name || "Unknown";
    $("popup-username").textContent = "@" + (data.username || "");
    $("popup-city").innerHTML     = `<i class='bx bx-map'></i> ${data.city||""}`;
    openModal("user-profile-popup");
}

// ── CITY CHAT ──
function initChat() {
    if (chatUnsub) chatUnsub();
    $("chat-messages").innerHTML = "";
    $("chat-city-label").innerHTML = `<i class='bx bx-map-alt'></i> ${cityId} Chat`;
    
    chatUnsub = db.collection("cityChats").doc(cityId).collection("messages").orderBy("timestamp","desc").limit(60).onSnapshot(snap => {
        const msgs = [];
        snap.forEach(d => msgs.push({id:d.id,...d.data()}));
        msgs.reverse();
        $("chat-messages").innerHTML = "";
        msgs.forEach(appendChatMsg);
        $("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
    });
    listenOnlineCount();
}

function appendChatMsg(msg) {
    const uid = auth.currentUser?.uid;
    const self = msg.senderId === uid;
    const div = document.createElement("div");
    div.className = `chat-msg${self?" self":""}`;
    div.innerHTML = `
        ${!self ? `<div class="chat-msg-avatar" style="background-image:url('${msg.senderPhotoUrl||""}')"></div>` : ""}
        <div class="chat-bubble">
            ${!self ? `<span class="chat-sender">${msg.senderName||"?"}</span>` : ""}
            ${escHtml(msg.content||"")}
        </div>`;
    $("chat-messages").appendChild(div);
}

async function sendChatMsg() {
    const text = $("chat-input").value.trim();
    if (!text || !auth.currentUser || !currentUser) return;
    $("chat-input").value = "";
    await db.collection("cityChats").doc(cityId).collection("messages").add({
        senderId:    auth.currentUser.uid,
        senderName:  currentUser.name,
        senderAvatar:currentUser.avatarSeed || "user_init",
        senderPhotoUrl: currentUser.profilePhotoUrl,
        content: text,
        type: "text",
        isSeen: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
}

function listenOnlineCount() {
    db.collection("users").where("city","==",cityId).where("is_online","==",true).onSnapshot(snap => {
        $("chat-online-count").textContent = `● ${snap.size} online`;
    });
}

// ── INBOX (Conversations) ──
function initInbox() {
    if (!auth.currentUser) return;
    if (inboxUnsub) inboxUnsub();
    const uid = auth.currentUser.uid;
    
    inboxUnsub = db.collection("conversations").where("participants","array-contains",uid).onSnapshot(snap => {
        const convos = snap.docs.map(d=>({id:d.id,...d.data()}))
            .sort((a,b)=>(b.timestamp?.toMillis()||0)-(a.timestamp?.toMillis()||0));
        renderInbox(convos, uid);
        const unread = convos.filter(c=>c.unreadCount>0 && c.lastSenderId!==uid).length;
        const badge = $("inbox-badge");
        if (badge) {
            badge.style.display = unread ? "flex" : "none";
            badge.textContent = unread || "";
        }
    });
}

function renderInbox(convos, uid) {
    const list = $("inbox-list");
    if (!convos.length) {
        list.innerHTML = `<div class="empty-state"><i class='bx bx-message-dots'></i><p>No conversations yet.</p></div>`;
        return;
    }
    list.innerHTML = "";
    convos.forEach(c => {
        const otherId = (c.participants||[]).find(p=>p!==uid) || "";
        const div = document.createElement("div");
        div.className = "inbox-item";
        div.innerHTML = `
            <div class="inbox-avatar" id="ia-${c.id}"></div>
            <div class="inbox-info">
                <div class="inbox-name" id="in-${c.id}">Loading…</div>
                <div class="inbox-preview">${escHtml(c.lastMessage||"")}</div>
            </div>
            ${c.unreadCount && c.lastSenderId!==uid
                ? `<div class="inbox-unread"></div>`:""}`;
        div.addEventListener("click", () => openInboxConvo(otherId));
        list.appendChild(div);
        // Load other user data
        db.collection("users").doc(otherId).get().then(snap => {
            if (!snap.exists) return;
            const d = snap.data();
            const ia = document.getElementById(`ia-${c.id}`);
            const ib = document.getElementById(`in-${c.id}`);
            if (ia) ia.style.backgroundImage = `url('${d.profilePhotoUrl||""}')`;
            if (ib) ib.textContent = d.name || "Unknown";
        });
    });
}

function openInboxConvo(otherUid) {
    showView("inbox");
    // For now shows city chat — full DM screen can be a future extension
}

// ── UTILS ──
function escHtml(str) {
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}
function setErr(id, msg) { const el = $(id); if (el) el.textContent = msg; }
function friendlyError(e) {
    const m = { "auth/wrong-password":"Incorrect password.",
                "auth/user-not-found":"No account with this email.",
                "auth/email-already-in-use":"Email already in use.",
                "auth/weak-password":"Password too short (min 6 chars).",
                "auth/invalid-email":"Invalid email address." };
    return m[e.code] || e.message;
}

// ── CLEANUP on tab close ──
window.addEventListener("beforeunload", () => {
    if (auth.currentUser && currentUser) {
        navigator.sendBeacon && fetch; // best-effort
        db.collection("users").doc(auth.currentUser.uid).update({ 
            is_sharing_location:false, 
            is_online:false, 
            lastSeen: firebase.firestore.FieldValue.serverTimestamp() 
        }).catch(()=>{});
    }
});
