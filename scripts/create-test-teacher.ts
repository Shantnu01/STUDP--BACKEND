import admin from 'firebase-admin'
import dotenv from 'dotenv'
dotenv.config()

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const auth = admin.auth()
const db   = admin.firestore()

async function main() {
  const principalEmail = 'shahilkr001@gmail.com'
  const teacherEmail   = 'unified@teacher.in'
  const teacherPass    = 'Uni234ied'

  console.log('\n=== TEACHER PROVISION SCRIPT ===')

  // 1. Get principal + school
  const principalUser = await auth.getUserByEmail(principalEmail)
  const principalDoc  = await db.collection('users').doc(principalUser.uid).get()
  const schoolId      = principalDoc.data()?.schoolId
  console.log('[1] SchoolId:', schoolId)

  // 2. Clean up any existing teacher with same email
  try {
    const existing = await auth.getUserByEmail(teacherEmail)
    await auth.deleteUser(existing.uid)
    console.log('[2] Deleted old auth user')
  } catch { console.log('[2] No existing auth user') }

  const existingSnap = await db.collection('teachers').where('email', '==', teacherEmail).get()
  if (!existingSnap.empty) {
    for (const d of existingSnap.docs) await d.ref.delete()
    console.log('[2] Deleted old teacher doc(s)')
  }

  const existingUser = await db.collection('users').where('email', '==', teacherEmail).get()
  if (!existingUser.empty) {
    for (const d of existingUser.docs) await d.ref.delete()
  }

  // 3. Create Firebase Auth user
  const newUser = await auth.createUser({
    email:         teacherEmail,
    password:      teacherPass,
    displayName:   'Unified Teacher',
    emailVerified: true,
  })
  console.log('[3] Firebase Auth UID:', newUser.uid)

  // 4. Create teacher profile in 'teachers' collection
  const teacherRef = await db.collection('teachers').add({
    uid:          newUser.uid,
    schoolId,
    name:         'Unified Teacher',
    email:        teacherEmail,
    phone:        '1234567890',
    subject:      'Science',
    subjects:     ['Science'],
    classes:      ['6'],
    employeeId:   'EMP001',
    qualification:'B.Ed',
    joinDate:     '2024-01-01',
    role:         'teacher',
    status:       'active',
    createdAt:    new Date().toISOString(),
  })
  console.log('[4] Teacher doc created:', teacherRef.id)

  // 5. Sync to 'users' collection (required by auth middleware)
  await db.collection('users').doc(newUser.uid).set({
    uid:      newUser.uid,
    schoolId,
    email:    teacherEmail,
    role:     'teacher',
    status:   'active',
    displayName: 'Unified Teacher',
  })
  console.log('[5] Users collection synced')

  // 6. Final verification
  const verify = await auth.getUser(newUser.uid)
  console.log('\n=== ✅ TEACHER READY ===')
  console.log('Email:    ' + teacherEmail)
  console.log('Password: ' + teacherPass)
  console.log('Portal:   http://localhost:3000/login  (SAME as principal, no port 3001 needed)')
  console.log('Role:     teacher  →  will redirect to /teacher/dashboard')
}

main().then(() => process.exit(0)).catch(e => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
