import { Router, Response } from 'express'
import { adminOnly, verifyToken, AuthRequest } from '../middleware/auth'
import { auth, db } from '../config/firebase'
import { z } from 'zod'

// ── PAYMENTS ──────────────────────────────────────────────────────────────────
export const paymentsRouter = Router()

const PaymentSchema = z.object({
  schoolId:   z.string(),
  schoolName: z.string(),
  plan:       z.enum(['Starter', 'Growth', 'Enterprise']),
  amount:     z.number().positive(),
  status:     z.enum(['paid', 'pending', 'overdue', 'failed']).default('pending'),
  date:       z.string().optional(),
  due:        z.string().optional(),
  dueDate:    z.string().optional(),
})

function normalizePayment(data: any) {
  return {
    ...data,
    date: data.date || data.createdAt || '',
    due: data.due || data.dueDate || '',
    dueDate: data.dueDate || data.due || '',
  }
}

function buildPaymentSummary(all: any[]) {
  const collected = all
    .filter((payment: any) => payment.status === 'paid')
    .reduce((total: number, payment: any) => total + (payment.amount || 0), 0)
  const overdue = all
    .filter((payment: any) => payment.status === 'overdue')
    .reduce((total: number, payment: any) => total + (payment.amount || 0), 0)
  const pending = all
    .filter((payment: any) => payment.status === 'pending')
    .reduce((total: number, payment: any) => total + (payment.amount || 0), 0)

  return {
    totalPaid:    collected,
    totalOverdue: overdue,
    totalPending: pending,
    countFailed:  all.filter((payment: any) => payment.status === 'failed').length,
    count:        all.length,
    collected,
    overdue,
    pending,
    total:        all.length,
  }
}

async function updatePaymentStatus(id: string, status: 'paid' | 'pending' | 'overdue' | 'failed') {
  await db.collection('payments').doc(id).update({
    status,
    updatedAt: new Date().toISOString(),
  })
}

paymentsRouter.get('/', ...adminOnly, async (_req, res: Response) => {
  const snap = await db.collection('payments').orderBy('createdAt', 'desc').get()
  res.json({ payments: snap.docs.map(d => ({ id: d.id, ...normalizePayment(d.data()) })) })
})

paymentsRouter.post('/', ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = PaymentSchema.parse(req.body)
    const normalized = normalizePayment({
      ...data,
      date: data.date || new Date().toISOString(),
    })
    const ref = await db.collection('payments').add({
      ...normalized,
      createdAt: new Date().toISOString(),
      createdBy: req.uid,
    })
    res.status(201).json({ id: ref.id, ...normalized })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

paymentsRouter.patch('/:id/status', ...adminOnly, async (req: AuthRequest, res: Response) => {
  const { status } = z.object({ status: z.enum(['paid','pending','overdue','failed']) }).parse(req.body)
  await updatePaymentStatus(req.params.id, status)
  res.json({ id: req.params.id, status })
})

paymentsRouter.patch('/:id', ...adminOnly, async (req: AuthRequest, res: Response) => {
  const { status } = z.object({ status: z.enum(['paid','pending','overdue','failed']) }).parse(req.body)
  await updatePaymentStatus(req.params.id, status)
  res.json({ id: req.params.id, status })
})

async function sendPaymentSummary(res: Response) {
  const snap = await db.collection('payments').get()
  const all  = snap.docs.map(d => normalizePayment(d.data()) as any)
  res.json(buildPaymentSummary(all))
}

paymentsRouter.get('/summary', ...adminOnly, async (_req, res: Response) => {
  await sendPaymentSummary(res)
})

paymentsRouter.get('/stats', ...adminOnly, async (_req, res: Response) => {
  await sendPaymentSummary(res)
})

// ── REGISTRATIONS ─────────────────────────────────────────────────────────────
export const registrationsRouter = Router()

const RegSchema = z.object({
  schoolName:  z.string().min(2),
  city:        z.string().default(''),
  plan:        z.string().default('None'),
  students:    z.number().int().min(0).default(0),
  email:       z.string().email(),
  contactName: z.string().min(2),
  phone:       z.string().optional().default(''),
  message:     z.string().optional(),
  uid:         z.string().optional().default(''),
})

const RegistrationAccountSchema = RegSchema.extend({
  password:    z.string().min(6),
  role:        z.string().min(2).default('Principal'),
  address:     z.string().default(''),
})

// Public: anyone can submit a registration
registrationsRouter.post('/', async (req, res: Response) => {
  try {
    const data = RegSchema.parse(req.body)
    const ref = await db.collection('registrations').add({
      ...data, status: 'pending', createdAt: new Date().toISOString(),
    })
    res.status(201).json({ id: ref.id, message: 'Registration submitted. We\'ll be in touch!' })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

registrationsRouter.post('/account', async (req, res: Response) => {
  let createdUid = ''

  try {
    const data = RegistrationAccountSchema.parse(req.body)
    const authUser = await auth.createUser({
      email: data.email,
      password: data.password,
      displayName: data.contactName,
    })
    createdUid = authUser.uid

    const { password, ...registrationData } = data
    const ref = await db.collection('registrations').add({
      ...registrationData,
      uid: authUser.uid,
      status: 'pending',
      createdAt: new Date().toISOString(),
    })

    res.status(201).json({
      id: ref.id,
      uid: authUser.uid,
      message: 'Registration submitted. Await admin approval before logging in.',
    })
  } catch (e: any) {
    if (createdUid) {
      try {
        await auth.deleteUser(createdUid)
      } catch (cleanupError: any) {
        console.error('[registrations/account cleanup]', cleanupError.message)
      }
    }

    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

registrationsRouter.get('/', ...adminOnly, async (_req, res: Response) => {
  const snap = await db.collection('registrations').orderBy('createdAt', 'desc').get()
  const registrations = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  res.json({ registrations, requests: registrations })
})

registrationsRouter.patch('/:id/approve', ...adminOnly, async (req: AuthRequest, res: Response) => {
  const regDoc = await db.collection('registrations').doc(req.params.id).get()
  if (!regDoc.exists) return res.status(404).json({ error: 'Not found' })
  const reg = regDoc.data()!
  // Approve: update status + create school
  await db.collection('registrations').doc(req.params.id).update({ 
    status: 'approved', approvedBy: req.uid, approvedAt: new Date().toISOString() 
  })
  
  const schoolRef = await db.collection('schools').add({
    name: reg.schoolName, city: reg.city, plan: reg.plan,
    students: reg.students, email: reg.email, phone: reg.phone || '',
    status: 'active', lastPayment: '', createdAt: new Date().toISOString(),
  })

  // Create the principal user record
  // We assume the UID was provided during signup (as cred.user.uid)
  if (reg.uid) {
    await db.collection('users').doc(reg.uid).set({
      email:       reg.email,
      displayName: reg.contactName,
      role:        'principal',
      schoolId:    schoolRef.id,
      status:      'active',
      createdAt:   new Date().toISOString(),
    })
  }

  res.json({ approved: req.params.id, schoolId: schoolRef.id, userId: reg.uid })
})

registrationsRouter.patch('/:id/reject', ...adminOnly, async (req: AuthRequest, res: Response) => {
  await db.collection('registrations').doc(req.params.id).update({ status: 'rejected', rejectedBy: req.uid, rejectedAt: new Date().toISOString() })
  res.json({ rejected: req.params.id })
})

// ── MESSAGING ─────────────────────────────────────────────────────────────────
export const messagesRouter = Router()

messagesRouter.get('/:schoolId/thread', ...adminOnly, async (req, res: Response) => {
  const snap = await db.collection('messages').doc(req.params.schoolId).collection('thread').orderBy('ts').get()
  res.json({ messages: snap.docs.map(d => ({ id: d.id, ...d.data() })) })
})

messagesRouter.post('/:schoolId/thread', ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { text } = z.object({ text: z.string().min(1) }).parse(req.body)
    const ref = await db.collection('messages').doc(req.params.schoolId).collection('thread').add({
      text, sender: 'admin', senderEmail: req.email, ts: new Date().toISOString(),
    })
    res.status(201).json({ id: ref.id, text })
  } catch (e: any) {
    res.status(e.name === 'ZodError' ? 400 : 500).json({ error: e.errors ?? e.message })
  }
})

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
export const analyticsRouter = Router()

function buildAnalyticsPayload(schools: any[], payments: any[], pendingRequests: number) {
  const PRICES = { 'Enterprise Excellence': 12000, 'Academy Pro': 7500, 'Institutional Starter': 2500 } as any
  const active = schools.filter((school: any) => school.status === 'active')
  const mrr = active.reduce((total: number, school: any) => total + (PRICES[school.plan] ?? 2500), 0)
  const planSplit = ['Enterprise Excellence', 'Academy Pro', 'Institutional Starter'].map(plan => ({
    plan,
    count: schools.filter((school: any) => school.plan === plan).length,
    revenue: schools
      .filter((school: any) => school.plan === plan && school.status === 'active')
      .reduce((total: number) => total + PRICES[plan], 0),
  }))

  return {
    mrr,
    arr: mrr * 12,
    activeSchools:   active.length,
    totalSchools:    schools.length,
    pendingRequests,
    overdueSchools:  schools.filter((school: any) => school.status === 'overdue').length,
    totalRevenue:    payments
      .filter((payment: any) => payment.status === 'paid')
      .reduce((total: number, payment: any) => total + payment.amount, 0),
    totalStudents:   schools.reduce((total: number, school: any) => total + Number(school.students || 0), 0),
    planSplit,
    planDistribution: Object.fromEntries(planSplit.map(item => [item.plan, item.count])),
  }
}

async function sendAnalytics(res: Response) {
  const [schoolsSnap, paymentsSnap, registrationsSnap] = await Promise.all([
    db.collection('schools').get(),
    db.collection('payments').get(),
    db.collection('registrations').where('status', '==', 'pending').get(),
  ])
  const schools  = schoolsSnap.docs.map(d => d.data() as any)
  const payments = paymentsSnap.docs.map(d => normalizePayment(d.data()) as any)
  res.json(buildAnalyticsPayload(schools, payments, registrationsSnap.size))
}

analyticsRouter.get('/dashboard', ...adminOnly, async (_req, res: Response) => {
  await sendAnalytics(res)
})

analyticsRouter.get('/overview', ...adminOnly, async (_req, res: Response) => {
  await sendAnalytics(res)
})

