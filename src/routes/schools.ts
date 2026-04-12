import { Router, Response } from 'express'
import { adminOnly, AuthRequest } from '../middleware/auth'
import { db } from '../config/firebase'
import { z } from 'zod'

const router = Router()

const SchoolSchema = z.object({
  name:        z.string().min(1),
  city:        z.string().default(''),
  plan:        z.enum(['Starter', 'Growth', 'Enterprise']),
  students:    z.number().int().min(0).default(0),
  email:       z.string().email().optional().or(z.literal('')),
  phone:       z.string().default(''),
  status:      z.enum(['active', 'overdue', 'suspended']).default('active'),
  lastPayment: z.string().default(''),
  notes:       z.string().default(''),
})

// GET /api/schools — list all
router.get('/', ...adminOnly, async (_req: AuthRequest, res: Response) => {
  try {
    const snap = await db.collection('schools').orderBy('name').get()
    const schools = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
    res.json({ schools, total: schools.length })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/schools/:id
router.get('/:id', ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const doc = await db.collection('schools').doc(req.params.id).get()
    if (!doc.exists) return res.status(404).json({ error: 'School not found' })
    res.json({ id: doc.id, ...doc.data() })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/schools — create
router.post('/', ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = SchoolSchema.parse(req.body)
    const ref = await db.collection('schools').add({
      ...data,
      createdAt: new Date().toISOString(),
      createdBy: req.uid,
    })
    res.status(201).json({ id: ref.id, ...data })
  } catch (e: any) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors })
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/schools/:id — update
router.patch('/:id', ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = SchoolSchema.partial().parse(req.body)
    await db.collection('schools').doc(req.params.id).update({
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: req.uid,
    })
    res.json({ id: req.params.id, ...data })
  } catch (e: any) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors })
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/schools/:id
router.delete('/:id', ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    await db.collection('schools').doc(req.params.id).delete()
    res.json({ deleted: req.params.id })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/schools/:id/stats — school detail stats
router.get('/:id/stats', ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const [schoolDoc, paymentsSnap, messagesSnap] = await Promise.all([
      db.collection('schools').doc(req.params.id).get(),
      db.collection('payments').where('schoolId', '==', req.params.id).get(),
      db.collection('messages').doc(req.params.id).collection('thread').orderBy('ts', 'desc').limit(1).get(),
    ])
    if (!schoolDoc.exists) return res.status(404).json({ error: 'School not found' })
    const payments = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const totalPaid = payments.filter((p: any) => p.status === 'paid').reduce((a: number, p: any) => a + (p.amount || 0), 0)
    res.json({
      school: { id: schoolDoc.id, ...schoolDoc.data() },
      stats:  { paymentCount: payments.length, totalPaid, lastMessage: messagesSnap.docs[0]?.data() ?? null },
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
