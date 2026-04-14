import { db } from '../src/config/firebase';

async function migrate() {
  console.log('🚀 Starting teacher profile migration...');
  const teachers = await db.collection('teachers').get();
  console.log(`🔍 Found ${teachers.size} teachers.`);

  let count = 0;
  for (const doc of teachers.docs) {
    const data = doc.data();
    if (data.uid) {
      await db.collection('users').doc(data.uid).set({
        role: 'teacher',
        schoolId: data.schoolId,
        displayName: data.name,
        email: data.email,
        status: data.status || 'active',
        updatedAt: new Date().toISOString()
      }, { merge: true });
      count++;
      console.log(`✅ Migrated [${count}/${teachers.size}]: ${data.name}`);
    } else {
      console.log(`⚠️  Skipping ${data.name} (No UID found)`);
    }
  }

  console.log('\n✨ Migration Complete!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration Failed:', err);
  process.exit(1);
});
