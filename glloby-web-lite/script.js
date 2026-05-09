// ==========================================
// CONFIGURATION PLACEHOLDERS
// ==========================================

// Firebase v9 Configuration (Replace with actual Glloby details)
const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
    projectId: "YOUR_FIREBASE_PROJECT_ID",
    storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID"
};

// Cloudinary Configuration for Unsigned Uploads
const CLOUDINARY_CLOUD_NAME = "YOUR_CLOUD_NAME";
const CLOUDINARY_UPLOAD_PRESET = "YOUR_UNSIGNED_UPLOAD_PRESET";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// ==========================================
// IMPORTS & INITIALIZATION
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Init Firebase
// Uncomment this once config is valid
// const app = initializeApp(firebaseConfig);
// const db = getFirestore(app);

// State Management
let currentUser = {
    name: null,
    pfpUrl: null,
    location: null
};
let map = null;
let userMarker = null;

// ==========================================
// DOM ELEMENTS
// ==========================================
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item[data-target]');
const premiumTriggers = document.querySelectorAll('.premium-trigger');

const authModal = document.getElementById('auth-modal');
const premiumModal = document.getElementById('premium-modal');
const closeModalBtn = document.querySelector('.close-modal');

const avatarPreview = document.getElementById('avatar-preview');
const pfpUpload = document.getElementById('pfp-upload');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const authStatus = document.getElementById('auth-status');

const profileImgDisplay = document.getElementById('profile-img-display');
const profileNameDisplay = document.getElementById('profile-name-display');

const chatMessages = document.getElementById('chat-messages');
const chatInputField = document.getElementById('chat-input-field');
const sendMsgBtn = document.getElementById('send-msg-btn');

// ==========================================
// ROUTING (SPA LOGIC)
// ==========================================
function switchView(targetId) {
    views.forEach(view => view.classList.remove('active'));
    navItems.forEach(nav => nav.classList.remove('active'));
    
    const targetView = document.getElementById(`view-${targetId}`);
    if (targetView) targetView.classList.add('active');
    
    const activeNav = document.querySelector(`.nav-item[data-target="${targetId}"]`);
    if (activeNav) activeNav.classList.add('active');

    // Force Leaflet to recalculate size when map container becomes visible
    if (targetId === 'map' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

function handleRoute() {
    const path = window.location.pathname;
    
    if (path.startsWith('/messages')) {
        switchView('messages');
    } else if (path.startsWith('/profile')) {
        switchView('profile');
    } else {
        // Default route or /map
        switchView('map');
    }
}

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = item.getAttribute('data-target');
        const href = item.getAttribute('href');
        
        window.history.pushState({}, '', href);
        handleRoute();
    });
});

window.addEventListener('popstate', handleRoute);

// ==========================================
// FEATURE LOCK MODAL
// ==========================================
premiumTriggers.forEach(trigger => {
    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        premiumModal.classList.add('active');
    });
});

closeModalBtn.addEventListener('click', () => {
    premiumModal.classList.remove('active');
});

// ==========================================
// LOCATION LOGIC
// ==========================================
async function getUserLocation() {
    return new Promise((resolve) => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => resolve([position.coords.latitude, position.coords.longitude]),
                async (error) => {
                    console.warn("GPS Denied. Falling back to IP...");
                    resolve(await getFallbackLocation());
                },
                { timeout: 7000, enableHighAccuracy: true }
            );
        } else {
            console.warn("Geolocation unsupported. Falling back to IP...");
            getFallbackLocation().then(resolve);
        }
    });
}

async function getFallbackLocation() {
    try {
        const response = await fetch('http://ip-api.com/json/');
        const data = await response.json();
        if (data.status === 'success') {
            return [data.lat, data.lon];
        }
    } catch (e) {
        console.error("IP fallback failed", e);
    }
    // Hard fallback: Rabat-Salé-Kénitra, Morocco
    return [34.020882, -6.841650];
}

// ==========================================
// MAP INITIALIZATION (Leaflet)
// ==========================================
async function initMap() {
    if (map) return;

    // Initialize with a zoomed out view, then fly to location
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([31.7917, -7.0926], 6);
    
    // Premium Dark CartoDB Tiles for aesthetics
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    // Get Actual Location
    const coords = await getUserLocation();
    currentUser.location = coords;

    // Cinematic fly-to animation with zoom 13
    map.flyTo(coords, 13, { animate: true, duration: 2 });

    // Custom Pulse Marker
    const userIcon = L.divIcon({
        className: 'user-pulse-marker',
        html: `<div class="pulse"></div><div class="marker-avatar" style="background-image: url('${currentUser.pfpUrl}')"></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    userMarker = L.marker(coords, { icon: userIcon }).addTo(map);
}

// ==========================================
// AUTHENTICATION & IMAGE UPLOAD
// ==========================================
let selectedFile = null;

pfpUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (event) => {
            avatarPreview.style.backgroundImage = `url(${event.target.result})`;
            avatarPreview.innerHTML = ''; // Hide icon
        };
        reader.readAsDataURL(file);
    }
});

joinBtn.addEventListener('click', async () => {
    const name = usernameInput.value.trim();
    if (!name) {
        authStatus.innerText = "Please enter your name.";
        return;
    }
    if (!selectedFile) {
        authStatus.innerText = "Please upload a profile picture.";
        return;
    }

    joinBtn.disabled = true;
    joinBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Joining...";

    try {
        // --- CLOUDINARY UPLOAD LOGIC ---
        let uploadedUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff`; 
        
        if (CLOUDINARY_UPLOAD_PRESET !== "YOUR_UNSIGNED_UPLOAD_PRESET") {
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
            
            const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
            const data = await res.json();
            
            if (data.secure_url) {
                uploadedUrl = data.secure_url;
            } else {
                throw new Error("Upload to Cloudinary failed.");
            }
        }

        // Set state
        currentUser.name = name;
        currentUser.pfpUrl = uploadedUrl;

        // Update UI
        profileImgDisplay.src = currentUser.pfpUrl;
        profileNameDisplay.innerText = currentUser.name;
        authModal.classList.remove('active');
        
        // Boot systems
        initMap();
        initChat();

    } catch (e) {
        console.error(e);
        authStatus.innerText = "Error joining. Please try again.";
        joinBtn.disabled = false;
        joinBtn.innerText = "Explore Map";
    }
});

// ==========================================
// FIREBASE REALTIME CHAT LOGIC
// ==========================================
function initChat() {
    // If Firebase isn't configured, mock the chat interface
    if (firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
        renderMessage({ text: "Welcome to Glloby Web Lite! This is a preview chat since Firebase is not yet connected.", user: "System", pfp: "https://ui-avatars.com/api/?name=S&background=3b82f6&color=fff" });
        return;
    }

    const chatRef = collection(db, "global_chat");
    const q = query(chatRef, orderBy("createdAt", "desc"), limit(50));

    onSnapshot(q, (snapshot) => {
        chatMessages.innerHTML = ''; 
        const messages = [];
        snapshot.forEach((doc) => messages.push({id: doc.id, ...doc.data()}));
        
        // Reverse to render newest at the bottom
        messages.reverse().forEach(renderMessage);
        
        // Auto scroll
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

function renderMessage(msg) {
    const isSelf = msg.user === currentUser.name;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${isSelf ? 'self' : ''}`;
    
    msgDiv.innerHTML = `
        ${!isSelf ? `<div class="msg-avatar" style="background-image: url('${msg.pfp}')"></div>` : ''}
        <div class="msg-bubble">
            ${!isSelf ? `<strong style="font-size: 12px; color: var(--primary); display:block; margin-bottom: 4px;">${msg.user}</strong>` : ''}
            ${msg.text}
        </div>
    `;
    
    chatMessages.appendChild(msgDiv);
}

async function sendChatMessage() {
    const text = chatInputField.value.trim();
    if (!text) return;
    
    chatInputField.value = '';
    
    // Mock if no firebase
    if (firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
        renderMessage({ text: text, user: currentUser.name, pfp: currentUser.pfpUrl });
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return;
    }
    
    try {
        await addDoc(collection(db, "global_chat"), {
            text: text,
            user: currentUser.name,
            pfp: currentUser.pfpUrl,
            createdAt: serverTimestamp()
        });
    } catch (e) {
        console.error("Error sending message", e);
    }
}

sendMsgBtn.addEventListener('click', sendChatMessage);
chatInputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

// Init routing on page load
handleRoute();
