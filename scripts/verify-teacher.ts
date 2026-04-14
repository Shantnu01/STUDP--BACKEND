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
  const email    = 'unified@teacher.in'
  const password = 'Uni234ied'

  console.log('\n=== TEACHER VERIFICATION ===')

  try {
    const user = await auth.getUserByEmail(email)
    console.log('[Auth] UID:', user.uid)
    console.log('[Auth] Verified:', user.emailVerified, '| Disabled:', user.disabled)

    const teacherSnap = await db.collection('teachers').where('uid', '==', user.uid).limit(1).get()
    console.log('[teachers coll] Exists:', !teacherSnap.empty)
    if (!teacherSnap.empty) {
      const t = teacherSnap.docs[0].data()
      console.log('  name:', t.name, '| school:', t.schoolId, '| classes:', JSON.stringify(t.classes))
    }

    const userDoc = await db.collection('users').doc(user.uid).get()
    console.log('[users coll] Exists:', userDoc.exists, '| role:', userDoc.data()?.role)

  } catch (e: any) {
    console.error('FAIL:', e.message)
  }

  console.log('\n✅ Login credentials:')
  console.log('  Email:    ' + email)
  console.log('  Password: ' + password)
  console.log('  URL:      http://localhost:3000/login (same as principal)')
  console.log('\n=== DONE ===')
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1) })
