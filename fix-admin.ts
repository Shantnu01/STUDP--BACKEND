import { db, auth } from './src/config/firebase';

async function fix() {
  const email = 'admin@edusync.in';
  try {
    const user = await auth.getUserByEmail(email);
    console.log('Found user UID:', user.uid);
    await db.collection('admins').doc(user.uid).set({
      email: email,
      role: 'admin',
      displayName: 'Super Admin',
      createdAt: new Date().toISOString()
    });
    console.log('Successfully added Admin role to Firestore!');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
fix();
