import { Router, Response } from 'express'
import { adminOnly, verifyToken, AuthRequest } from '../middleware/auth'
import { auth, db } from '../config/firebase'
import { z } from 'zod'
import { sendOtpEmail } from '../services/mailService'

const OTP_COLLECTION = 'otps'

const router = Router()

// POST /api/auth/create-admin — create admin user + write to /admins collection
router.post('/create-admin', ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, displayName } = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      displayName: z.string().optional(),
    }).parse(req.body)

    const user = await auth.createUser({ email, password, displayName })
    await db.collection('admins').doc(user.uid).set({
      email, displayName: displayName || '', role: 'admin',
      createdBy: req.uid, createdAt: new Date().toISOString(),
    })
    res.status(201).json({ uid: user.uid, email })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})
// GET /api/auth/me — current user info
router.get('/me', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const [user, adminDoc, userDoc, registrationSnap] = await Promise.all([
      auth.getUser(req.uid!),
      db.collection('admins').doc(req.uid!).get(),
      db.collection('users').doc(req.uid!).get(),
      db.collection('registrations').where('uid', '==', req.uid!).limit(1).get(),
    ])

    console.log(`[auth/me] UID:${req.uid!} Admin:${adminDoc.exists} User:${userDoc.exists} Reg:${!registrationSnap.empty}`)

    // Check if user exists in the admins collection
    if (adminDoc.exists) {
      return res.json({
        uid:         user.uid,
        email:       user.email,
        displayName: user.displayName || adminDoc.data()?.displayName,
        role:        'admin',
      })
    }

    // Check if they are a principal in the users collection
    if (userDoc.exists) {
      const userData = userDoc.data()!
      // Only active principals may access the portal
      if (userData.status === 'suspended') {
        return res.status(403).json({ error: 'Account suspended. Contact your administrator.' })
      }
      return res.json({
        uid:         user.uid,
        email:       user.email,
        displayName: user.displayName || userData.displayName,
        role:        userData.role ?? 'unknown',
        schoolId:    userData.schoolId,
        status:      userData.status,
      })
    }

    // Unknown user — return 403, not a 200 with 'user' role
    // This prevents unprovisioned accounts from being routed anywhere
    if (!registrationSnap.empty) {
      const registration = registrationSnap.docs[0].data()

      if (registration.status === 'pending') {
        return res.status(403).json({ error: 'Your registration is pending admin approval.' })
      }

      if (registration.status === 'rejected') {
        return res.status(403).json({ error: 'Your registration request was rejected. Contact the administrator.' })
      }

      if (registration.status === 'approved') {
        return res.status(403).json({ error: 'Your account is being prepared. Please try again shortly.' })
      }
    }

    return res.status(403).json({ error: 'No portal access assigned to this account.' })
  } catch (e: any) {
    // Never expose internal error details
    console.error('[auth/me]', e.message)
    res.status(500).json({ error: 'Could not retrieve account information.' })
  }
})

// POST /api/auth/setup-first-admin — one-time bootstrap (disable after use!)
// Call this once to create your very first admin account
router.post('/setup-first-admin', async (req, res: Response) => {
  const SETUP_KEY = process.env.SETUP_KEY
  if (!SETUP_KEY || req.headers['x-setup-key'] !== SETUP_KEY) {
    return res.status(403).json({ error: 'Invalid setup key' })
  }
  try {
    const { email, password, displayName } = req.body
    const adminsSnap = await db.collection('admins').limit(1).get()
    if (!adminsSnap.empty) return res.status(400).json({ error: 'Admin already exists' })

    const user = await auth.createUser({ email, password, displayName: displayName || 'Admin' })
    await db.collection('admins').doc(user.uid).set({
      email, displayName: displayName || 'Admin', role: 'admin',
      createdAt: new Date().toISOString(),
    })
    res.status(201).json({ uid: user.uid, email, message: 'First admin created!' })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})
// POST /api/auth/send-signup-otp
router.post('/send-signup-otp', async (req, res: Response) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
    
    // Check if email already exists in Auth
    try {
      await auth.getUserByEmail(email)
      return res.status(400).json({ error: 'This email is already registered.' })
    } catch (e) {}

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    await db.collection(OTP_COLLECTION).doc(email).set({
      otp,
      expiresAt,
      createdAt: new Date().toISOString()
    })

    await sendOtpEmail(email, otp)
    res.json({ message: 'Security code dispatched.' })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// POST /api/auth/verify-signup-otp
router.post('/verify-signup-otp', async (req, res: Response) => {
  try {
    const { email, otp } = z.object({
      email: z.string().email(),
      otp: z.string().length(6)
    }).parse(req.body)

    const otpDoc = await db.collection(OTP_COLLECTION).doc(email).get()
    if (!otpDoc.exists) return res.status(400).json({ error: 'Invalid or expired code.' })

    const data = otpDoc.data()!
    if (data.otp !== otp) return res.status(400).json({ error: 'Incorrect security code.' })
    
    if (new Date() > new Date(data.expiresAt)) {
      await db.collection(OTP_COLLECTION).doc(email).delete()
      return res.status(400).json({ error: 'Security code expired.' })
    }

    // Optional: Delete OTP after use
    await db.collection(OTP_COLLECTION).doc(email).delete()
    res.json({ success: true, message: 'Identity verified.' })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// POST /api/auth/sso-token — Cross-domain SSO token exchange
router.post('/sso-token', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    // req.uid is securely injected by verifyToken verifying the ID token
    const customToken = await auth.createCustomToken(req.uid!)
    res.json({ customToken })
  } catch (e: any) {
    console.error('[sso-token error]', e.message)
    res.status(500).json({ error: 'Failed to generate SSO Custom Token' })
  }
})

export default router
