const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
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