const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueCreated } = require("firebase-functions/v2/database");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
initializeApp({ databaseURL: "https://tyyt-b1d84-default-rtdb.firebaseio.com" });

const KEYS = ["dashboard","production_view","production_add","production_edit","production_delete","lines_manage","maintenance_view","maintenance_add","maintenance_update","maintenance_delete","reports_view","users_manage","settings_manage"];
const roles = ["hall_manager","supervisor","production_clerk","technician","custom"];

async function callerProfile(uid) {
  const snap = await getDatabase().ref(`users/${uid}`).get();
  const p = snap.val();
  if (!p || p.active !== true) throw new HttpsError("permission-denied","الحساب غير مفعل.");
  if (p.role !== "admin" && p.permissions?.users_manage !== true) throw new HttpsError("permission-denied","لا تملك صلاحية إدارة المستخدمين.");
  return p;
}
function sanitizePermissions(requested, caller, role) {
  const result = {};
  for (const k of KEYS) {
    const wanted = requested && requested[k] === true;
    if (caller.role !== "admin" && wanted && caller.permissions?.[k] !== true) {
      throw new HttpsError("permission-denied",`لا يمكنك منح صلاحية لا تملكها: ${k}`);
    }
    result[k] = caller.role === "admin" && role === "admin" ? true : wanted;
  }
  return result;
}
exports.createManagedUser = onCall({region:"us-central1"}, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated","سجّل الدخول أولًا.");
  const caller = await callerProfile(request.auth.uid);
  const d = request.data || {};
  const email = typeof d.email === "string" ? d.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument","البريد الإلكتروني غير صحيح.");
  if (typeof d.password !== "string" || d.password.length < 6) throw new HttpsError("invalid-argument","كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
  if (typeof d.displayName !== "string" || !d.displayName.trim()) throw new HttpsError("invalid-argument","اكتب اسم المستخدم.");
  const role = d.role;
  if (role !== "admin" && !roles.includes(role)) throw new HttpsError("invalid-argument","نوع الحساب غير صالح.");
  if (role === "admin" && caller.role !== "admin") throw new HttpsError("permission-denied","المدير العادي لا يستطيع إنشاء مدير نظام.");
  const permissions = sanitizePermissions(d.permissions, caller, role);
  let user;
  try {
    user = await getAuth().createUser({email,password:d.password,displayName:d.displayName.trim(),disabled:false});
    await getDatabase().ref(`users/${user.uid}`).set({
      uid:user.uid,email,displayName:d.displayName.trim(),role,permissions,
      lineIds:Array.isArray(d.lineIds)?d.lineIds.filter(x=>typeof x==="string").slice(0,100):[],
      active:true,createdBy:request.auth.uid,createdAt:Date.now(),updatedAt:Date.now()
    });
    return {uid:user.uid,email,role};
  } catch (err) {
    if (user?.uid) { try { await getAuth().deleteUser(user.uid); } catch (_) {} }
    if (err.code === "auth/email-already-exists") throw new HttpsError("already-exists","البريد الإلكتروني مستخدم بالفعل.");
    throw new HttpsError("internal","فشل إنشاء الحساب. تأكد من إعداد Cloud Functions.");
  }
});

exports.updateManagedUser = onCall({region:"us-central1"}, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated","سجّل الدخول أولًا.");
  const caller = await callerProfile(request.auth.uid);
  const d = request.data || {};
  if (typeof d.uid !== "string" || !d.uid) throw new HttpsError("invalid-argument","معرّف المستخدم غير صحيح.");
  if (d.uid === request.auth.uid) throw new HttpsError("failed-precondition","لا يمكنك تعديل حالة حسابك من هنا.");
  const targetRef = getDatabase().ref(`users/${d.uid}`);
  const snap = await targetRef.get();
  const target = snap.val();
  if (!target) throw new HttpsError("not-found","المستخدم غير موجود.");
  if (caller.role !== "admin" && (target.role === "admin" || target.createdBy !== request.auth.uid)) throw new HttpsError("permission-denied","يمكنك إدارة المستخدمين الذين أنشأتهم فقط.");
  if (typeof d.active === "boolean" && Object.keys(d).length === 2) {
    await targetRef.update({active:d.active,updatedAt:Date.now(),updatedBy:request.auth.uid});
    await getAuth().updateUser(d.uid,{disabled:!d.active});
    return {uid:d.uid,active:d.active};
  }
  if (typeof d.displayName !== "string" || !d.displayName.trim()) throw new HttpsError("invalid-argument","الاسم غير صحيح.");
  const role = d.role;
  if (role === "admin" && caller.role !== "admin") throw new HttpsError("permission-denied","لا يمكنك تعيين دور مدير النظام.");
  if (role !== "admin" && !roles.includes(role)) throw new HttpsError("invalid-argument","نوع الحساب غير صالح.");
  const permissions = sanitizePermissions(d.permissions,caller,role);
  await targetRef.update({displayName:d.displayName.trim(),role,permissions,updatedAt:Date.now(),updatedBy:request.auth.uid});
  await getAuth().updateUser(d.uid,{displayName:d.displayName.trim()});
  return {uid:d.uid,role};
});

// Store a browser's FCM token securely from an authenticated client.
exports.saveNotificationToken = onCall({region:"us-central1"}, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "سجّل الدخول أولًا.");
  const uid = request.auth.uid;
  const profileSnap = await getDatabase().ref(`users/${uid}`).get();
  const profile = profileSnap.val();
  if (!profile || profile.active !== true) throw new HttpsError("permission-denied", "الحساب غير مفعل.");
  const token = request.data && request.data.token;
  if (typeof token !== "string" || token.length < 30 || token.length > 4096) throw new HttpsError("invalid-argument", "رمز الإشعارات غير صالح.");
  const key = token.replace(/[.#$\[\]/]/g, "_");
  await getDatabase().ref(`notificationTokens/${uid}/${key}`).set({token, uid, updatedAt:Date.now(), active:true});
  return {saved:true};
});

async function sendPushToActiveUsers(title, body, tag, extra={}) {
  const db = getDatabase();
  const [usersSnap, tokensSnap] = await Promise.all([
    db.ref("users").get(), db.ref("notificationTokens").get()
  ]);
  const users = usersSnap.val() || {};
  const tokenTree = tokensSnap.val() || {};
  const tokens = [];
  for (const [uid, userTokens] of Object.entries(tokenTree)) {
    if (users[uid]?.active !== true) continue;
    for (const item of Object.values(userTokens || {})) if (item?.active !== false && typeof item?.token === "string") tokens.push(item.token);
  }
  const unique = [...new Set(tokens)];
  for (let i=0; i<unique.length; i+=500) {
    const batch = unique.slice(i,i+500);
    if (!batch.length) continue;
    const result = await getMessaging().sendEachForMulticast({
      tokens: batch,
      data: {title, body, tag, route: tag.startsWith("maintenance") ? "maintenance" : "dashboard", ...Object.fromEntries(Object.entries(extra).map(([k,v])=>[k,String(v)]))},
      webpush: {headers: {TTL: "3600"}}
    });
    const invalid=[];
    result.responses.forEach((r,index)=>{if(!r.success && ["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(r.error?.code))invalid.push(batch[index]);});
    if(invalid.length) {
      const updates={};
      for(const token of invalid){const key=token.replace(/[.#$\[\]/]/g,"_");for(const uid of Object.keys(tokenTree)) updates[`notificationTokens/${uid}/${key}`]=null;}
      await db.ref().update(updates);
    }
  }
}

exports.notifyNewMaintenanceIssue = onValueCreated({ref:"/maintenance/{issueId}", region:"us-central1"}, async event => {
  const issue = event.data.val();
  if (!issue) return;
  const [lineSnap] = await Promise.all([getDatabase().ref(`lines/${issue.lineId}`).get()]);
  const line = lineSnap.val() || {};
  await sendPushToActiveUsers("بلاغ عطل ماكينة جديد", `${issue.machineName || "ماكينة"} — ${line.name || "خط غير محدد"}: ${issue.description || "بلاغ صيانة"}`, `maintenance-${event.params.issueId}`, {issueId:event.params.issueId});
});

exports.notifyProductionShortfall = onValueCreated({ref:"/production/{entryId}", region:"us-central1"}, async event => {
  const entry = event.data.val();
  if (!entry || !entry.lineId || !entry.date) return;
  const db = getDatabase();
  const [lineSnap, productionSnap] = await Promise.all([
    db.ref(`lines/${entry.lineId}`).get(), db.ref("production").get()
  ]);
  const line = lineSnap.val() || {};
  const target = Number(line.target || 0);
  if (!target) return;
  let total = 0;
  for (const p of Object.values(productionSnap.val() || {})) if (p.lineId === entry.lineId && p.date === entry.date) total += Number(p.assembly || 0);
  if (total >= target) return;
  const dateKey = String(entry.date).replace(/[^0-9-]/g, "_");
  const markerRef = db.ref(`notificationMarkers/production_${entry.lineId}_${dateKey}`);
  let createdMarker = false;
  const marker = await markerRef.transaction(current => { if (current !== null) return; createdMarker = true; return {sentAt:Date.now(), total, target}; });
  if (!marker.committed || !createdMarker) return;
  await sendPushToActiveUsers("تنبيه عجز إنتاج", `خط ${line.name || "الإنتاج"}: المسجل ${total} قطعة من المستهدف ${target} حتى الآن.`, `production-${entry.lineId}-${dateKey}`, {lineId:entry.lineId, date:entry.date});
});
