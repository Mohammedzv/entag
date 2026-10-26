/* EBM web push service worker. Keep this file at the website root. */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyARcxaAgJI5AxZuvrR8OxcBn4l0J5fxCIs",
  authDomain: "tyyt-b1d84.firebaseapp.com",
  databaseURL: "https://tyyt-b1d84-default-rtdb.firebaseio.com",
  projectId: "tyyt-b1d84",
  storageBucket: "tyyt-b1d84.firebasestorage.app",
  messagingSenderId: "335241087888",
  appId: "1:335241087888:web:19d58929234f0c706e8115",
  measurementId: "G-PFBDLBCM29"
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const notification = payload.notification || {};
  self.registration.showNotification(notification.title || "تنبيه EBM", {
    body: notification.body || "يوجد تحديث جديد في نظام الإنتاج والصيانة.",
    tag: payload.data?.tag || "ebm-update",
    renotify: false,
    data: { route: payload.data?.route || "dashboard" }
  });
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const route = event.notification.data?.route || "dashboard";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ("focus" in client) { client.focus(); client.postMessage({ type: "EBM_NOTIFICATION_CLICK", route }); return; }
    }
    return clients.openWindow("./");
  }));
});
