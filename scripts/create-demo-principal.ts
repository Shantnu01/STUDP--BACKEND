/**
 * Creates a demo principal account for testing.
 * Run: npx ts-node create-demo-principal.ts
 *
 * This script:
 * 1. Creates a Firebase Auth user (my@gmail.com / my@12345)
 * 2. Creates a demo school in Firestore
 * 3. Creates a users doc giving them the 'principal' role
 */
import * as admin from 'firebase-admin'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '../.env') })

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
  const EMAIL    = process.env.DEMO_PRINCIPAL_EMAIL || 'demo@edusync.in'
  const PASSWORD = process.env.DEMO_PRINCIPAL_PASSWORD || 'EduSync@Demo2026'
  const NAME     = 'Demo Principal'

  console.log('\n🔧 Creating demo principal account...\n')

  // 1. Create or get Auth user
  let uid: string
  try {
    const existing = await auth.getUserByEmail(EMAIL)
    uid = existing.uid
    await auth.updateUser(uid, { password: PASSWORD, displayName: NAME })
    console.log(`✅ Firebase Auth user already exists — updated password. UID: ${uid}`)
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') {
      const user = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: NAME })
      uid = user.uid
      console.log(`✅ Firebase Auth user created. UID: ${uid}`)
    } else {
      throw e
    }
  }

  // 2. Create a demo school (if not already present)
  const schoolSnap = await db.collection('schools').where('email', '==', EMAIL).limit(1).get()
  let schoolId: string

  if (!schoolSnap.empty) {
    schoolId = schoolSnap.docs[0].id
    console.log(`✅ Demo school already exists. School ID: ${schoolId}`)
  } else {
    const schoolRef = await db.collection('schools').add({
      name:        'Demo School',
      city:        'Mumbai',
      plan:        'Starter',
      students:    250,
      email:       EMAIL,
      phone:       '+91 98765 00000',
      status:      'active',
      lastPayment: new Date().toISOString().split('T')[0],
      createdAt:   new Date().toISOString(),
    })
    schoolId = schoolRef.id
    console.log(`✅ Demo school created. School ID: ${schoolId}`)
  }

  // 3. Create/overwrite users doc to give principal role
  await db.collection('users').doc(uid).set({
    email:       EMAIL,
    displayName: NAME,
    role:        'principal',
    schoolId:    schoolId,
    status:      'active',
    createdAt:   new Date().toISOString(),
  })
  console.log(`✅ Principal user doc created in Firestore.`)

  console.log('\n🎉 Demo Principal account ready!')
  console.log(`   Email:    ${EMAIL}`)
  console.log(`   Password: ${PASSWORD}`)
  console.log(`   School:   Demo School (ID: ${schoolId})`)
  console.log(`   Role:     principal\n`)

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
