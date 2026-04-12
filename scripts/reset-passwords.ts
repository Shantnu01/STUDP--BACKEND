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

async function reset(email, password) {
  try {
    const user = await auth.getUserByEmail(email)
    await auth.updateUser(user.uid, { password })
    console.log(`Password for ${email} reset to '${password}'`)
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') {
      await auth.createUser({ email, password })
      console.log(`User ${email} created with password '${password}'`)
    } else {
      console.error('Error:', e)
    }
  }
}

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@edusync.in'
  const adminPass  = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@EduSync2026'

  console.log('\n🔧 Resetting admin credentials...\n')
  await reset(adminEmail, adminPass)
  process.exit(0)
}

main()
