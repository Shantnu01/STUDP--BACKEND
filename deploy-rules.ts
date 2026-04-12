import * as admin from 'firebase-admin'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.join(__dirname, '.env') })

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

async function main() {
  const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8')
  
  // The Admin SDK has securityRules() function to deploy rules
  const project = admin.securityRules()
  
  await project.releaseFirestoreRulesetFromSource(rules)
  console.log('✅ Firestore rules deployed successfully!')
  process.exit(0)
}

main().catch(e => {
  console.error('❌ Error deploying rules:', e)
  process.exit(1)
})
