// ==========================================
// CONFIGURATION PLACEHOLDERS
// ==========================================

const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
    projectId: "YOUR_FIREBASE_PROJECT_ID",
    storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID"
};

const CLOUDINARY_CLOUD_NAME = "YOUR_CLOUD_NAME";
const CLOUDINARY_UPLOAD_PRESET = "YOUR_UNSIGNED_UPLOAD_PRESET";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// ==========================================
// IMPORTS
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, onSnapshot, query, orderBy, limit, serverTimestamp, where, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// State
let currentUser = null; // Holds the UserModel data
let map = null;
let myMarker = null;
const mapMarkers = {}; // uid -> L.marker
let currentCityId = "Rabat";
let chatUnsubscribe = null;
let usersUnsubscribe = null;
let isMockMode = firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY";

// ==========================================
// DOM ELEMENTS
// ==========================================
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item[data-target]');
const authModal = document.getElementById('auth-modal');
const authStep1 = document.getElementById('auth-step-1');
const authStep2 = document.getElementById('auth-step-2');
const premiumModal = document.getElementById('premium-modal');
const closeModalBtn = document.querySelector('.close-modal');

// Auth DOM
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const anonLoginBtn = document.getElementById('anon-login-btn');
const authStatus1 = document.getElementById('auth-status-1');

// Setup DOM
const avatarPreview = document.getElementById('avatar-preview');
const pfpUpload = document.getElementById('pfp-upload');
const setupName = document.getElementById('setup-name');
const setupUsername = document.getElementById('setup-username');
const setupAge = document.getElementById('setup-age');
const setupGender = document.getElementById('setup-gender');
const setupCity = document.getElementById('setup-city');
const completeSetupBtn = document.getElementById('complete-setup-btn');
const authStatus2 = document.getElementById('auth-status-2');

// Profile & Chat DOM
const profileImgDisplay = document.getElementById('profile-img-display');
const profileNameDisplay = document.getElementById('profile-name-display');
const profileUsernameDisplay = document.getElementById('profile-username-display');
const profileCityDisplay = document.getElementById('profile-city-display');
const logoutBtn = document.getElementById('logout-btn');

const chatHeaderTitle = document.getElementById('chat-header-title');
const chatMessages = document.getElementById('chat-messages');
const chatInputField = document.getElementById('chat-input-field');
const sendMsgBtn = document.getElementById('send-msg-btn');
const recenterBtn = document.getElementById('recenter-btn');

// ==========================================
// ROUTING
// ==========================================
function switchView(targetId) {
    views.forEach(view => view.classList.remove('active'));
    navItems.forEach(nav => nav.classList.remove('active'));
    document.getElementById(`view-${targetId}`)?.classList.add('active');
    document.querySelector(`.nav-item[data-target="${targetId}"]`)?.classList.add('active');

    if (targetId === 'map' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

function handleRoute() {
    const path = window.location.pathname;
    if (path.startsWith('/messages')) switchView('messages');
    else if (path.startsWith('/profile')) switchView('profile');
    else switchView('map');
}

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        if (item.classList.contains('premium-trigger')) return; // handled separately
        window.history.pushState({}, '', item.getAttribute('href'));
        handleRoute();
    });
});
window.addEventListener('popstate', handleRoute);

document.querySelectorAll('.premium-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        premiumModal.classList.add('active');
    });
});
closeModalBtn.addEventListener('click', () => premiumModal.classList.remove('active'));

// ==========================================
// AUTHENTICATION FLOW
// ==========================================

onAuthStateChanged(auth, async (user) => {
    if (isMockMode) return; // Ignore if firebase not set
    if (user) {
        // Check if profile exists
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists() && userDoc.data().name) {
            currentUser = userDoc.data();
            currentCityId = currentUser.city || "Rabat";
            updateProfileUI();
            authModal.classList.remove('active');
            startApp();
        } else {
            // Profile setup needed
            authStep1.style.display = 'none';
            authStep2.style.display = 'block';
        }
    } else {
        // Not logged in
        authStep1.style.display = 'block';
        authStep2.style.display = 'none';
        authModal.classList.add('active');
        stopApp();
    }
});

// Login Handlers
loginBtn.addEventListener('click', async () => {
    if(isMockMode) return mockStart();
    try {
        authStatus1.innerText = "Signing in...";
        await signInWithEmailAndPassword(auth, loginEmail.value, loginPassword.value);
    } catch (e) {
        authStatus1.innerText = e.message;
    }
});

registerBtn.addEventListener('click', async () => {
    if(isMockMode) return mockStart();
    try {
        authStatus1.innerText = "Creating account...";
        await createUserWithEmailAndPassword(auth, loginEmail.value, loginPassword.value);
    } catch (e) {
        authStatus1.innerText = e.message;
    }
});

anonLoginBtn.addEventListener('click', async () => {
    if(isMockMode) return mockStart();
    try {
        authStatus1.innerText = "Connecting anonymously...";
        await signInAnonymously(auth);
    } catch (e) {
        authStatus1.innerText = e.message;
    }
});

logoutBtn.addEventListener('click', async () => {
    if(isMockMode) return window.location.reload();
    if (auth.currentUser) {
        // Set sharing location to false before sign out
        await updateDoc(doc(db, "users", auth.currentUser.uid), { is_sharing_location: false }).catch(()=>{});
        await signOut(auth);
    }
});

// Profile Setup
let selectedFile = null;
pfpUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (event) => {
            avatarPreview.style.backgroundImage = `url(${event.target.result})`;
            avatarPreview.innerHTML = '';
        };
        reader.readAsDataURL(file);
    }
});

completeSetupBtn.addEventListener('click', async () => {
    const name = setupName.value.trim();
    const username = setupUsername.value.trim();
    const age = setupAge.value;
    const gender = setupGender.value;
    const city = setupCity.value;

    if (!name || !username || !age || !gender || !city) {
        authStatus2.innerText = "Please fill all fields.";
        return;
    }
    if (!selectedFile && CLOUDINARY_UPLOAD_PRESET !== "YOUR_UNSIGNED_UPLOAD_PRESET") {
        authStatus2.innerText = "Profile picture required.";
        return;
    }

    completeSetupBtn.disabled = true;
    completeSetupBtn.innerHTML = "Saving...";

    try {
        let uploadedUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff`; 
        
        if (selectedFile && CLOUDINARY_UPLOAD_PRESET !== "YOUR_UNSIGNED_UPLOAD_PRESET") {
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
            const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
            const data = await res.json();
            if (data.secure_url) uploadedUrl = data.secure_url;
        }

        const userDocRef = doc(db, "users", auth.currentUser.uid);
        const userData = {
            uid: auth.currentUser.uid,
            email: auth.currentUser.email || '',
            name: name,
            username: username,
            age: parseInt(age),
            gender: gender,
            city: city,
            avatarSeed: "user_init",
            profilePhotoUrl: uploadedUrl,
            isAnonymous: auth.currentUser.isAnonymous,
            createdAt: serverTimestamp(),
            friends: [],
            is_sharing_location: false
        };

        await setDoc(userDocRef, userData, { merge: true });
        
        currentUser = userData;
        currentCityId = city;
        updateProfileUI();
        authModal.classList.remove('active');
        startApp();

    } catch (e) {
        authStatus2.innerText = e.message;
        completeSetupBtn.disabled = false;
        completeSetupBtn.innerHTML = "Finish Setup";
    }
});

function updateProfileUI() {
    if (!currentUser) return;
    profileImgDisplay.src = currentUser.profilePhotoUrl || 'default.png';
    profileNameDisplay.innerText = currentUser.name;
    profileUsernameDisplay.innerText = '@' + currentUser.username;
    profileCityDisplay.innerHTML = `<i class='bx bx-map'></i> ${currentUser.city}`;
    chatHeaderTitle.innerText = `${currentUser.city} Chat`;
}

// ==========================================
// CORE APP LOGIC (Map & Chat)
// ==========================================

function startApp() {
    initMap();
    initChat();
}

function stopApp() {
    if (chatUnsubscribe) chatUnsubscribe();
    if (usersUnsubscribe) usersUnsubscribe();
    if (map) {
        map.remove();
        map = null;
    }
    for (let uid in mapMarkers) {
        delete mapMarkers[uid];
    }
}

// Map Engine
async function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([31.7917, -7.0926], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    const coords = await getUserLocation();
    
    map.flyTo(coords, 14, { animate: true, duration: 2 });
    
    // Update presence
    updatePresence(coords);

    // Listen to all users
    listenToUsers();
}

async function updatePresence(coords) {
    if (isMockMode) {
        renderMockMarker(coords);
        return;
    }
    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
            'location': {
                latitude: coords[0],
                longitude: coords[1],
                timestamp: serverTimestamp()
            },
            'is_sharing_location': true
        });
    } catch(e) { console.error("Presence error", e); }
}

function listenToUsers() {
    if(isMockMode) return;
    const qUsers = query(collection(db, "users"), where("is_sharing_location", "==", true));
    usersUnsubscribe = onSnapshot(qUsers, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const uid = change.doc.id;
            
            if (change.type === "added" || change.type === "modified") {
                if (data.location && data.location.latitude) {
                    if (uid === auth.currentUser.uid) {
                        // Keep track of our own marker
                        if (!myMarker) {
                            myMarker = createMarker([data.location.latitude, data.location.longitude], data);
                            myMarker.addTo(map);
                        } else {
                            myMarker.setLatLng([data.location.latitude, data.location.longitude]);
                        }
                    } else {
                        // Other users
                        if (!mapMarkers[uid]) {
                            mapMarkers[uid] = createMarker([data.location.latitude, data.location.longitude], data);
                            mapMarkers[uid].addTo(map);
                        } else {
                            mapMarkers[uid].setLatLng([data.location.latitude, data.location.longitude]);
                        }
                    }
                }
            }
            if (change.type === "removed" || !data.is_sharing_location) {
                if (mapMarkers[uid]) {
                    map.removeLayer(mapMarkers[uid]);
                    delete mapMarkers[uid];
                }
            }
        });
    });
}

function createMarker(coords, userData) {
    const userIcon = L.divIcon({
        className: 'user-pulse-marker',
        html: `<div class="pulse"></div><div class="marker-avatar" style="background-image: url('${userData.profilePhotoUrl || 'default.png'}')"></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
    return L.marker(coords, { icon: userIcon }).bindPopup(`<b>${userData.name}</b><br>@${userData.username}`);
}

async function getUserLocation() {
    return new Promise((resolve) => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
                async () => resolve(await getFallbackLocation()),
                { timeout: 7000, enableHighAccuracy: true }
            );
        } else resolve(getFallbackLocation());
    });
}

async function getFallbackLocation() {
    try {
        const response = await fetch('http://ip-api.com/json/');
        const data = await response.json();
        if (data.status === 'success') return [data.lat, data.lon];
    } catch (e) {}
    return [34.020882, -6.841650]; // Rabat
}

recenterBtn.addEventListener('click', async () => {
    if(!map) return;
    const coords = await getUserLocation();
    map.flyTo(coords, 14, { animate: true, duration: 1 });
    updatePresence(coords);
});

// City Chat Engine
function initChat() {
    if (isMockMode) {
        renderMessage({ content: "Firebase is not configured. This is a mock chat.", senderName: "System", type: "text" });
        return;
    }

    const chatRef = collection(db, "cityChats", currentCityId, "messages");
    const q = query(chatRef, orderBy("timestamp", "desc"), limit(50));

    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        chatMessages.innerHTML = ''; 
        const messages = [];
        snapshot.forEach((doc) => messages.push({id: doc.id, ...doc.data()}));
        
        messages.reverse().forEach(renderMessage);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

function renderMessage(msg) {
    const isSelf = isMockMode ? true : msg.senderId === auth.currentUser.uid;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${isSelf ? 'self' : ''}`;
    
    msgDiv.innerHTML = `
        ${!isSelf ? `<div class="msg-avatar" style="background-image: url('${msg.senderPhotoUrl || 'default.png'}')"></div>` : ''}
        <div class="msg-bubble">
            ${!isSelf ? `<strong style="font-size: 12px; color: var(--primary); display:block; margin-bottom: 4px;">${msg.senderName}</strong>` : ''}
            ${msg.content}
        </div>
    `;
    chatMessages.appendChild(msgDiv);
}

sendMsgBtn.addEventListener('click', async () => {
    const text = chatInputField.value.trim();
    if (!text) return;
    chatInputField.value = '';
    
    if (isMockMode) {
        renderMessage({ content: text, senderName: currentUser?.name || "Mock User" });
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return;
    }
    
    try {
        await addDoc(collection(db, "cityChats", currentCityId, "messages"), {
            content: text,
            senderId: auth.currentUser.uid,
            senderName: currentUser.name || currentUser.username,
            senderPhotoUrl: currentUser.profilePhotoUrl,
            senderAvatar: currentUser.avatarSeed,
            type: 'text',
            isSeen: false,
            timestamp: serverTimestamp()
        });
    } catch (e) { console.error("Error sending message", e); }
});

chatInputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMsgBtn.click();
});

// Cleanup before closing tab
window.addEventListener('beforeunload', () => {
    if (auth?.currentUser && !isMockMode) {
        updateDoc(doc(db, "users", auth.currentUser.uid), { is_sharing_location: false });
    }
});

// Mock Fallback Setup
function mockStart() {
    currentUser = { name: "Demo User", username: "demo", city: "Rabat" };
    authModal.classList.remove('active');
    updateProfileUI();
    startApp();
}
function renderMockMarker(coords) {
    if(!myMarker && map) {
        myMarker = createMarker(coords, { name: "You", username: "demo" });
        myMarker.addTo(map);
    }
}

// Init Routing
handleRoute();
