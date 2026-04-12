/**
 * seed-demo.ts — Creates a demo principal + school with sample data
 * Run: npx ts-node -e "require('./seed-demo')"; or via ts-node directly
 *
 * Usage: npx ts-node seed-demo.ts
 */
import { auth, db } from './src/config/firebase';

const DEMO_PRINCIPAL_EMAIL = 'principal@edusync.in';
const DEMO_PRINCIPAL_PASSWORD = 'pass@123';
const DEMO_SCHOOL_NAME = 'EduSync Demo School';

async function seed() {
  console.log('🌱 Starting EduSync demo data seeding...\n');

  // ── 1. Create/verify principal Firebase Auth user ──────────────────────────
  let uid: string;
  try {
    const existing = await auth.getUserByEmail(DEMO_PRINCIPAL_EMAIL);
    uid = existing.uid;
    console.log(`✅ Principal already exists: ${uid}`);
  } catch {
    const created = await auth.createUser({
      email: DEMO_PRINCIPAL_EMAIL,
      password: DEMO_PRINCIPAL_PASSWORD,
      displayName: 'Dr. Anita Sharma',
      emailVerified: true,
    });
    uid = created.uid;
    console.log(`✅ Created principal user: ${uid}`);
  }

  // ── 2. Create/verify School document ──────────────────────────────────────
  let schoolId: string;
  const schoolsSnap = await db.collection('schools').where('name', '==', DEMO_SCHOOL_NAME).limit(1).get();
  if (!schoolsSnap.empty) {
    schoolId = schoolsSnap.docs[0].id;
    console.log(`✅ School already exists: ${schoolId}`);
  } else {
    const schoolRef = await db.collection('schools').add({
      name: DEMO_SCHOOL_NAME,
      city: 'Bangalore',
      plan: 'Growth',
      students: 0,
      email: DEMO_PRINCIPAL_EMAIL,
      phone: '+91 98765 43210',
      status: 'active',
      lastPayment: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
    });
    schoolId = schoolRef.id;
    console.log(`✅ Created school: ${schoolId}`);
  }

  // ── 3. Upsert Users document for the principal ─────────────────────────────
  await db.collection('users').doc(uid).set({
    email: DEMO_PRINCIPAL_EMAIL,
    displayName: 'Dr. Anita Sharma',
    role: 'principal',
    schoolId,
    status: 'active',
    createdAt: new Date().toISOString(),
  }, { merge: true });
  console.log(`✅ Upserted user profile with role=principal, schoolId=${schoolId}`);

  // ── 4. Seed Teachers ───────────────────────────────────────────────────────
  const teachers = [
    { name: 'Mr. Rajesh Kumar', subject: 'Mathematics', classes: 'Grade 9, Grade 10', status: 'Active', qualification: 'M.Sc Mathematics', experience: 8, phone: '+91 98001 11001', email: 'rajesh@edusync.in' },
    { name: 'Ms. Priya Nair', subject: 'English', classes: 'Grade 7, Grade 8', status: 'Active', qualification: 'MA English Literature', experience: 5, phone: '+91 98001 11002', email: 'priya@edusync.in' },
    { name: 'Mr. Suresh Menon', subject: 'Physics', classes: 'Grade 11, Grade 12', status: 'Active', qualification: 'M.Sc Physics', experience: 12, phone: '+91 98001 11003', email: 'suresh@edusync.in' },
    { name: 'Ms. Deepa Iyer', subject: 'Chemistry', classes: 'Grade 10, Grade 11', status: 'On Leave', qualification: 'M.Sc Chemistry', experience: 7, phone: '+91 98001 11004', email: 'deepa@edusync.in' },
    { name: 'Mr. Arun Patel', subject: 'Physical Education', classes: 'Grade 6, Grade 7', status: 'Active', qualification: 'B.P.Ed', experience: 4, phone: '+91 98001 11005', email: 'arun@edusync.in' },
  ];

  const teachersSnap = await db.collection('teachers').where('schoolId', '==', schoolId).limit(1).get();
  if (teachersSnap.empty) {
    for (const t of teachers) {
      await db.collection('teachers').add({ ...t, schoolId, createdAt: new Date().toISOString() });
    }
    console.log(`✅ Seeded ${teachers.length} teachers`);
  } else {
    console.log(`ℹ️  Teachers already seeded, skipping`);
  }

  // ── 5. Seed Staff ──────────────────────────────────────────────────────────
  const staff = [
    { name: 'Ramesh Pillai', role: 'Office Administrator', work: 'Administration', phone: '+91 98002 22001', email: 'ramesh@edusync.in', joiningDate: '2020-06-01' },
    { name: 'Kavitha Sharma', role: 'Librarian', work: 'Library Management', phone: '+91 98002 22002', email: 'kavitha@edusync.in', joiningDate: '2019-04-15' },
    { name: 'Mohan Das', role: 'Security Guard', work: 'Security', phone: '+91 98002 22003', email: 'mohan@edusync.in', joiningDate: '2021-01-10' },
    { name: 'Sunita Rao', role: 'Accountant', work: 'Finance', phone: '+91 98002 22004', email: 'sunita@edusync.in', joiningDate: '2022-07-20' },
  ];

  const staffSnap = await db.collection('staff').where('schoolId', '==', schoolId).limit(1).get();
  if (staffSnap.empty) {
    for (const s of staff) {
      await db.collection('staff').add({ ...s, schoolId, createdAt: new Date().toISOString() });
    }
    console.log(`✅ Seeded ${staff.length} staff members`);
  } else {
    console.log(`ℹ️  Staff already seeded, skipping`);
  }

  // ── 6. Seed Students ───────────────────────────────────────────────────────
  const studentsSnap = await db.collection('students').where('schoolId', '==', schoolId).limit(1).get();
  if (studentsSnap.empty) {
    const students = [
      { name: 'Anya Mehta', classId: 'Grade 12', section: 'A', rollNumber: '001', gender: 'Female', dob: '2007-03-15', parentName: 'Vikram Mehta', parentPhone: '+91 99001 00001', address: 'Koramangala, Bangalore' },
      { name: 'Arjun Kapoor', classId: 'Grade 10', section: 'A', rollNumber: '002', gender: 'Male', dob: '2009-07-22', parentName: 'Ravi Kapoor', parentPhone: '+91 99001 00002', address: 'Indiranagar, Bangalore' },
      { name: 'Priya Singh', classId: 'Grade 11', section: 'B', rollNumber: '003', gender: 'Female', dob: '2008-11-08', parentName: 'Mohan Singh', parentPhone: '+91 99001 00003', address: 'Whitefield, Bangalore' },
      { name: 'Rohan Gupta', classId: 'Grade 9', section: 'A', rollNumber: '004', gender: 'Male', dob: '2010-05-30', parentName: 'Suresh Gupta', parentPhone: '+91 99001 00004', address: 'HSR Layout, Bangalore' },
      { name: 'Sneha Reddy', classId: 'Grade 8', section: 'B', rollNumber: '005', gender: 'Female', dob: '2011-09-14', parentName: 'Krishna Reddy', parentPhone: '+91 99001 00005', address: 'BTM Layout, Bangalore' },
      { name: 'Karan Malhotra', classId: 'Grade 12', section: 'A', rollNumber: '006', gender: 'Male', dob: '2007-01-25', parentName: 'Anil Malhotra', parentPhone: '+91 99001 00006', address: 'Jayanagar, Bangalore' },
      { name: 'Divya Nair', classId: 'Grade 10', section: 'B', rollNumber: '007', gender: 'Female', dob: '2009-04-18', parentName: 'Sathish Nair', parentPhone: '+91 99001 00007', address: 'Rajajinagar, Bangalore' },
      { name: 'Amit Shah', classId: 'Grade 7', section: 'A', rollNumber: '008', gender: 'Male', dob: '2012-12-03', parentName: 'Dilip Shah', parentPhone: '+91 99001 00008', address: 'Hebbal, Bangalore' },
    ];

    // Auto-generate student IDs
    const year = new Date().getFullYear();
    for (let i = 0; i < students.length; i++) {
      const studentId = `STU-${year}-${String(i + 1).padStart(5, '0')}`;
      await db.collection('students').add({
        ...students[i],
        studentId,
        schoolId,
        feeStatus: i % 3 === 0 ? 'Overdue' : 'Paid',
        createdAt: new Date().toISOString(),
      });
    }
    // Update school's student count
    await db.collection('schools').doc(schoolId).update({ students: students.length });
    console.log(`✅ Seeded ${students.length} students`);
  } else {
    console.log(`ℹ️  Students already seeded, skipping`);
  }

  // ── 7. Seed Fee Config ─────────────────────────────────────────────────────
  const feeConfigs = [
    { classId: 'Grade 7', tuitionFee: 8000, labFee: 500, sportsFee: 300, transportFee: 1500 },
    { classId: 'Grade 8', tuitionFee: 8500, labFee: 500, sportsFee: 300, transportFee: 1500 },
    { classId: 'Grade 9', tuitionFee: 9000, labFee: 700, sportsFee: 300, transportFee: 1500 },
    { classId: 'Grade 10', tuitionFee: 9500, labFee: 700, sportsFee: 300, transportFee: 1500 },
    { classId: 'Grade 11', tuitionFee: 11000, labFee: 1000, sportsFee: 300, transportFee: 1500 },
    { classId: 'Grade 12', tuitionFee: 12000, labFee: 1000, sportsFee: 300, transportFee: 1500 },
  ];

  for (const config of feeConfigs) {
    const total = config.tuitionFee + config.labFee + config.sportsFee + config.transportFee;
    await db.collection('feeConfigs').doc(`${schoolId}_${config.classId}`).set({
      schoolId,
      ...config,
      totalFee: total,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }
  console.log(`✅ Seeded ${feeConfigs.length} fee configurations`);

  // ── 8. Done! ───────────────────────────────────────────────────────────────
  console.log('\n🎉 Demo data seeded successfully!');
  console.log('─'.repeat(40));
  console.log(`📧 Principal Email : ${DEMO_PRINCIPAL_EMAIL}`);
  console.log(`🔑 Password         : ${DEMO_PRINCIPAL_PASSWORD}`);
  console.log(`🏫 School ID        : ${schoolId}`);
  console.log(`🆔 Principal UID    : ${uid}`);
  console.log('─'.repeat(40));
  console.log('Login at http://localhost:3000 with the above credentials.\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seeding failed:', err.message || err);
  process.exit(1);
});
