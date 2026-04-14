import { auth, db } from '../src/config/firebase';

async function diagnose() {
  const email = 'shahilkr001@gmail.com';
  console.log(`--- [DIAGNOSTIC] ${email} ---`);
  
  try {
    const user = await auth.getUserByEmail(email);
    console.log('Firebase Auth UID:', user.uid);
    console.log('Email Verified:', user.emailVerified);
    console.log('Disabled:', user.disabled);

    const [adminDoc, userDoc, teacherSnap, registrationSnap] = await Promise.all([
      db.collection('admins').doc(user.uid).get(),
      db.collection('users').doc(user.uid).get(),
      db.collection('teachers').where('uid', '==', user.uid).limit(1).get(),
      db.collection('registrations').where('uid', '==', user.uid).limit(1).get(),
    ]);

    console.log('Profiles Found:');
    console.log(` - Admins Table: ${adminDoc.exists}`);
    console.log(` - Users Table (Principal): ${userDoc.exists}`);
    console.log(` - Teachers Table: ${!teacherSnap.empty}`);
    console.log(` - Registrations Table: ${!registrationSnap.empty}`);

    if (userDoc.exists) {
      console.log('User Profile Data:', JSON.stringify(userDoc.data(), null, 2));
    }
  } catch (e: any) {
    console.error('Diagnostic error:', e.message);
  }
}

diagnose().then(() => process.exit(0));
