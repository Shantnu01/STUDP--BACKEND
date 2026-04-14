import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const auth = admin.auth();
const db   = admin.firestore();

async function main() {
  const TARGET_EMAIL    = 'shahilkr001@gmail.com';
  const TARGET_PASSWORD = 'pass@123';

  console.log(`\n=== AUTH FIX SCRIPT ===`);
  console.log(`Target: ${TARGET_EMAIL}`);

  // 1. Look up the user
  let user: admin.auth.UserRecord;
  try {
    user = await auth.getUserByEmail(TARGET_EMAIL);
    console.log(`\n[1] Firebase Auth Found`);
    console.log(`    UID      : ${user.uid}`);
    console.log(`    Verified : ${user.emailVerified}`);
    console.log(`    Disabled : ${user.disabled}`);
    console.log(`    Providers: ${user.providerData.map(p => p.providerId).join(', ') || 'NONE'}`);
  } catch (e: any) {
    console.error(`[1] FAIL: User not found in Firebase Auth - ${e.message}`);
    process.exit(1);
  }

  // 2. Force-add Password provider via Admin SDK
  try {
    await auth.updateUser(user.uid, {
      password:      TARGET_PASSWORD,
      emailVerified: true,
      disabled:      false,
    });
    console.log(`\n[2] Password provider set to "${TARGET_PASSWORD}" ✅`);
  } catch (e: any) {
    console.error(`[2] FAIL: Could not set password - ${e.message}`);
    process.exit(1);
  }

  // 3. Ensure Firestore "users" profile has role=principal
  try {
    const ref = db.collection('users').doc(user.uid);
    const snap = await ref.get();
    console.log(`\n[3] Firestore users/${user.uid}`);
    if (snap.exists) {
      console.log(`    Existing: ${JSON.stringify(snap.data())}`);
    } else {
      console.log(`    Not found - will create.`);
    }
    await ref.set({
      email:       TARGET_EMAIL,
      role:        'principal',
      status:      'active',
      emailVerified: true,
      updatedAt:   new Date().toISOString(),
    }, { merge: true });
    console.log(`    Updated  : role=principal, status=active ✅`);
  } catch (e: any) {
    console.error(`[3] FAIL: Firestore update - ${e.message}`);
    process.exit(1);
  }

  // 4. Final verification
  const updated = await auth.getUser(user.uid);
  const userDoc  = await db.collection('users').doc(user.uid).get();
  console.log(`\n[4] FINAL STATE`);
  console.log(`    Providers: ${updated.providerData.map(p => p.providerId).join(', ')}`);
  console.log(`    Verified : ${updated.emailVerified}`);
  console.log(`    DB Role  : ${userDoc.data()?.role}`);
  console.log(`    DB Status: ${userDoc.data()?.status}`);
  console.log(`\n=== FIX COMPLETE ===`);
  console.log(`✅ Login: ${TARGET_EMAIL} / ${TARGET_PASSWORD}`);
}

main().then(() => process.exit(0)).catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
