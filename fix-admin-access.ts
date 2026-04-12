import { db, auth } from './src/config/firebase';

async function fixAdmin() {
  const targetEmail = 'shan01tnu@gmail.com';
  console.log(`Starting admin access fix for: ${targetEmail}`);

  try {
    // 1. Find the target user in Firebase Auth
    let user;
    try {
      user = await auth.getUserByEmail(targetEmail);
      console.log(`Found user in Auth: ${user.uid}`);
    } catch (e) {
      console.error(`Error: User with email ${targetEmail} not found in Firebase Auth. Please make sure the account is created first.`);
      process.exit(1);
    }

    // 2. Remove from 'users' collection (if they exist there as a principal)
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
      await db.collection('users').doc(user.uid).delete();
      console.log(`Removed ${targetEmail} from 'users' collection to avoid role conflicts.`);
    }

    // 3. Set as Admin in 'admins' collection
    await db.collection('admins').doc(user.uid).set({
      email: targetEmail,
      role: 'admin',
      displayName: user.displayName || 'System Admin',
      updatedAt: new Date().toISOString()
    });
    console.log(`Successfully set ${targetEmail} as Admin in Firestore.`);

    // 4. Purge all OTHER admins
    const adminsSnap = await db.collection('admins').get();
    let purgeCount = 0;
    for (const doc of adminsSnap.docs) {
      const adminData = doc.data();
      if (adminData.email !== targetEmail) {
        await db.collection('admins').doc(doc.id).delete();
        console.log(`Purged other admin: ${adminData.email}`);
        purgeCount++;
      }
    }
    console.log(`Purge complete. Total other admins removed: ${purgeCount}`);

    console.log('--- ALL TASKS COMPLETED SUCCESSFULLY ---');
    process.exit(0);
  } catch (err) {
    console.error('An unexpected error occurred:', err);
    process.exit(1);
  }
}

fixAdmin();
